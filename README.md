# knidos-zk

Zero-knowledge proof pipeline for verifying Binance Futures trading data. Combines zkTLS attestation, Noir circuit proving, and on-chain verification via zkVerify.

## Prerequisites

- **Node.js** >= 22
- **pnpm** (pinned via `corepack`, see Setup)
- **nargo** v1.0.0-beta.6 (Noir compiler)
- **bb** v0.84.0 (native Barretenberg CLI)
- **jq** (required by `bb` for `bytes_and_fields` output format)
- **Redis** (used as the job queue / cache backend)

### Installing nargo & bb

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup -v 1.0.0-beta.6

curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash
bbup -v 0.84.0
```

Verify installation:

```bash
nargo --version   # 1.0.0-beta.6
bb --version      # 0.84.0
```

By default the app expects the native prover at `~/.bb/bb`. You can override that with `BB_PATH`.

## Setup

```bash
corepack enable
pnpm install
```

`corepack enable` activates the pnpm version pinned in `package.json` (`packageManager` field). Only needed once per machine.

`postinstall` will automatically init the `noir_json_parser` submodule and apply the local patch from `patches/`.

Copy the environment template and fill in the required values:

```bash
cp .env.example .env
```

The runtime expects Binance Futures API credentials and a `BINANCE_SYMBOLS` CSV list in `.env`. The scheduler runs on a configurable interval (default every 15 minutes via `ZKTLS_WINDOW_MINUTES`), always proofs the previous full window, and fans out one independent proof pipeline per configured symbol. The internal proof type for that flow is `binance-fills`.

`zkTLS` uses Primus-aware backpressure. The runtime defers tasks when Primus capacity is constrained and reclaims fees from timed-out tasks only when the backlog justifies the settlement gas.

## Build & Run

```bash
pnpm build
pnpm node
```

For development with watch mode:

```bash
pnpm dev:node
```

The Noir proving worker count defaults to `1` and can be overridden with `NOIR_PROVING_SLOT_COUNT`.

## Lint & Format

```bash
pnpm lint
pnpm format
```

## Tests

```bash
npx tsc --noEmit
pnpm test
```

`pnpm test` runs circuit compilation, proof generation and local verification. It uses the same runtime env contract, so the required Binance and zkVerify variables must be present before running it.

## Scripts

```bash
# Retry all failed tasks (resets them to PENDING)
pnpm tasks:retry

# Retry only specific pipeline types
pnpm tasks:retry --type=zkTLS
pnpm tasks:retry --type=zkTLS,noir

# Show queue + task status across pipelines (PENDING, QUEUED, RUNNING, DEFERRED, ...)
pnpm queue:status

# Diagnostic: on-chain Primus state for the submitter address
# (maxUnsettledTaskCount, timedOut tasks, oldest submittedAt, etc.)
pnpm primus:status

# Reclaim locked ETH from timed-out Primus tasks. No-ops (reverts) if
# no task has passed its timeout — check `primus:status` first.
pnpm primus:reclaim

# Bridge ETH from Ethereum Sepolia to Base Sepolia for the submitter
# wallet. Requires Sepolia ETH on the wallet (PRIMUS_PRIVATE_KEY).
# See the script header for faucet links.
pnpm primus:bridge             # defaults to 0.05 ETH
pnpm primus:bridge 0.1         # custom amount

# Drop the MongoDB database and flush Redis
pnpm db:reset
```
