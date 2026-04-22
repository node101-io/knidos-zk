#!/usr/bin/env bash
# One-time Docker host DNS setup for knidos-zk.
#
# Configures /etc/docker/daemon.json with explicit DNS upstreams so that
# Docker's embedded DNS (127.0.0.11) can resolve external names even when
# the host runs systemd-resolved (whose 127.0.0.53 stub is unreachable from
# inside containers). Without this, container resolv.conf can end up with
# 127.0.0.53 instead of 127.0.0.11, breaking both Compose service discovery
# (e.g. `redis` hostname) and external lookups (Atlas, Primus RPC, zkVerify).
#
# Not deployment-mode specific: the systemd-resolved / Docker embedded-DNS
# mismatch can affect user-defined bridge networks (plain Compose) as well
# as overlay networks (Swarm).
#
# Idempotent: safe to re-run. Merges with any existing daemon.json keys.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

command -v jq >/dev/null || {
  echo "ERROR: jq is required. Install with: apt-get install -y jq" >&2
  exit 1
}

DESIRED=$(cat <<'EOF'
{
  "dns": ["1.1.1.1", "8.8.8.8"]
}
EOF
)

DST="/etc/docker/daemon.json"

if [[ -f "$DST" ]]; then
  MERGED=$(jq -s '.[0] * .[1]' "$DST" <(echo "$DESIRED"))
  if [[ "$(jq -S . "$DST")" == "$(echo "$MERGED" | jq -S .)" ]]; then
    echo "daemon.json already has required settings; no changes."
    exit 0
  fi
  echo "existing $DST differs from merged result:"
  diff <(jq -S . "$DST") <(echo "$MERGED" | jq -S .) || true
  read -r -p "apply merged config? [y/N] " -n 1 REPLY
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || { echo "aborted."; exit 1; }
  echo "$MERGED" > "$DST"
else
  mkdir -p "$(dirname "$DST")"
  echo "$DESIRED" > "$DST"
  chmod 0644 "$DST"
fi

echo "wrote $DST; restarting docker..."
systemctl restart docker
sleep 2
if docker info >/dev/null 2>&1; then
  echo "docker healthy."
else
  echo "ERROR: docker not responding after restart" >&2
  exit 1
fi
