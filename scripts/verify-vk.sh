#!/usr/bin/env bash
#
# Derive the circuit's verification key from source. Asserts that nargo + bb
# versions match the pins in packages/testnet-challenge/Dockerfile so the
# result is reproducible.
#
# Usage:
#   scripts/verify-vk.sh

set -euo pipefail

# Pinned versions — keep in sync with packages/testnet-challenge/Dockerfile.
NARGO_REQUIRED="1.0.0-beta.6"
BB_REQUIRED="0.84.0"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
amber() { printf '\033[33m%s\033[0m\n' "$*"; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$REPO_ROOT/circuit"
VK_PATH="$CIRCUIT_DIR/target/vk"

# ───── Step 1: assert toolchain present + pinned

require_cmd() {
  local cmd="$1" install_hint="$2"
  command -v "$cmd" >/dev/null 2>&1 || {
    red "missing: $cmd"
    echo "  install: $install_hint"
    exit 1
  }
}

require_cmd nargo "v$NARGO_REQUIRED — https://noir-lang.org/docs/getting_started/noir_installation"
require_cmd bb    "v$BB_REQUIRED — https://barretenberg.aztec.network/docs/getting_started/"
require_cmd jq    "https://jqlang.org/download/"

NARGO_HAVE="$(nargo --version | awk '/^nargo version/ {print $NF; exit}')"
BB_HAVE="$(bb --version | head -n1 | sed 's/^v//')"

if [[ "$NARGO_HAVE" != "$NARGO_REQUIRED" ]]; then
  red "nargo $NARGO_HAVE != required $NARGO_REQUIRED"
  echo "  download: https://noir-lang.org/docs/getting_started/noir_installation"
  exit 1
fi
if [[ "$BB_HAVE" != "$BB_REQUIRED" ]]; then
  red "bb $BB_HAVE != required $BB_REQUIRED"
  echo "  download: https://barretenberg.aztec.network/docs/getting_started/"
  exit 1
fi

green "✓ nargo $NARGO_HAVE, bb $BB_HAVE"

# ───── Step 2: RAM heads-up (bb peaks at ~6 GB during ultra_honk VK derivation)

case "$(uname -s)" in
  Darwin) TOTAL_BYTES="$(sysctl -n hw.memsize)" ;;
  Linux)  TOTAL_BYTES="$(awk '/MemTotal/ {print $2 * 1024; exit}' /proc/meminfo)" ;;
  *)      TOTAL_BYTES=0 ;;
esac
TOTAL_GB=$(( TOTAL_BYTES / 1024 / 1024 / 1024 ))
if (( TOTAL_GB > 0 && TOTAL_GB < 8 )); then
  amber "warning: bb's ultra_honk VK derivation peaks at ~6 GB; system has ${TOTAL_GB} GB — may OOM."
fi

# ───── Step 3: derive the VK from source

if [[ ! -d "$CIRCUIT_DIR" ]]; then
  red "circuit directory not found at $CIRCUIT_DIR"
  exit 1
fi

# noir_json_parser submodule + patch are required by the circuit build.
if [[ ! -f "$REPO_ROOT/noir_json_parser/Nargo.toml" ]]; then
  red "noir_json_parser submodule is empty"
  echo "  fix: git submodule update --init && pnpm install   # postinstall applies the patch"
  exit 1
fi

echo
echo "▶ nargo compile (skipping brillig constraint checks)"
( cd "$CIRCUIT_DIR" && nargo compile --skip-brillig-constraints-check )

echo
echo "▶ bb write_vk -s ultra_honk --oracle_hash keccak"
( cd "$CIRCUIT_DIR" && bb write_vk \
    -s ultra_honk \
    -b target/circuit.json \
    --oracle_hash keccak \
    --output_format bytes \
    -o target )

if [[ ! -f "$VK_PATH" ]]; then
  red "expected VK at $VK_PATH but it was not produced"
  exit 1
fi

LOCAL_SHA="$(shasum -a 256 "$VK_PATH" | awk '{print $1}')"
LOCAL_SIZE="$(wc -c < "$VK_PATH" | tr -d ' ')"

echo
green "✓ derived VK"
echo "  path:   $VK_PATH"
echo "  size:   ${LOCAL_SIZE} bytes"
echo "  sha256: 0x${LOCAL_SHA}"
