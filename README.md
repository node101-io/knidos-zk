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

For Base Sepolia reliability, keep `RPC_URL` as the primary endpoint and optionally set `RPC_FALLBACK_URLS` to a comma-separated list of secondary RPCs. Read-only JSON-RPC calls will fail over across that list on transient 429/5xx or transport errors; `eth_sendRawTransaction` stays pinned to the primary endpoint.

Production logs go to `stdout` as JSON; inspect them with `docker compose logs`.

## Repository layout

This is a pnpm workspace.

- `packages/zk-node/` — the daemon (`src/app.ts`) and HTTP API (`src/server.ts`) that together make up the proof pipeline. The package owns dependencies, the TypeScript build, lint, and tests.
- `packages/testnet-challange/` — the testnet challenge: a Hono API (`src/api/`, served via `Dockerfile.api`) plus an end-user CLI (`src/cli/`) that ships as a multi-arch Docker image. End-users `docker run` the CLI; it walks them through SIWE wallet-connect, displays the circuit's verification key, and grades a hardcoded set of records they verify on-chain.
- `circuit/`, `noir_json_parser/`, `patches/` — Noir toolchain assets shared across packages; stay at the repo root.
- `.env` lives at the repo root and is consumed by `docker compose` and by all runtime/dev scripts (which are defined in the root `package.json` and run with the repo root as cwd).

Run everything from the repo root. `pnpm node`, `pnpm dev:node`, `pnpm queue:status`, etc. are defined at the root and reach into `packages/zk-node/`. `pnpm build`, `pnpm lint`, and `pnpm test` delegate via `pnpm --filter zk-node ...`.

To add a new package, create `packages/<name>/` with its own `package.json` and `tsconfig.json` extending `tsconfig.base.json`; the workspace glob (`packages/*`) picks it up automatically.

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

## Production deployment (Docker Compose)

Production runs plain `docker compose` on a single host. The stack is three services — `node` (daemon), `server` (HTTP), and a local `redis`. MongoDB is external (Atlas). `nargo`, `bb`, Node, and pnpm are baked into the image; `docker` (with the compose plugin) is the only host prerequisite.

A `server` restart during deploy causes a brief (~20s) `connection refused` window on port 3000 — acceptable because the HTTP surface is a read-only verification API and clients retry. The `node` daemon has a ~30–90s Noir warmup on restart, but it has no inbound traffic so clients don't see it.

### First-time deploy

```bash
git clone <repo> /root/knidos-zk && cd /root/knidos-zk
git submodule update --init

cp .env.example .env   # fill in Atlas MONGO_URI, Primus keys, etc.

docker compose up -d --build                           # build image + start stack
docker compose ps                                      # should show redis/node/server running
```

Make sure the server's public IP is whitelisted in Atlas Network Access.

### Updating after a code change

```bash
cd /root/knidos-zk
git pull
git submodule update --init   # only if submodule changed

docker compose up -d --build  # rebuild image + recreate changed services
```

Compose rebuilds the image, then recreates containers whose image digest changed. The `server` container is stopped and replaced (~20s `start_period` before the healthcheck flips back to `healthy`); clients see a brief window of `connection refused`. The `node` daemon restarts and burns its Noir warmup again (~30–90s), invisible to clients.

To update a single service without touching the others:

```bash
docker compose up -d --build --force-recreate --no-deps server   # or: node
```

`server` and `node` share `knidos-zk:latest` (built from the same Dockerfile), so the `--build` step rebuilds the image once; `--no-deps` keeps the other containers running on their existing image instance; `--force-recreate` ensures the target picks up the new image.

### Rollback

```bash
git checkout <previous-sha>
docker compose up -d --build
```

### Operational commands

```bash
docker compose ps                                      # service status + health
docker compose logs -f node                            # daemon logs (wide events)
docker compose logs -f server                          # HTTP server logs
docker compose logs --since 1h node | jq 'select(.event=="task.attempt")'
docker compose restart node                            # restart single service (no rebuild)
docker compose down                                    # tear down stack (keeps volumes)
```

Docker engine is enabled on boot (`systemctl enable docker`). With `restart: unless-stopped` on every service, containers come back automatically after host reboot or crash — no PM2 or dedicated systemd unit required.

## Testnet Challenge

A separate, decoupled package (`packages/testnet-challange/`) consisting of two pieces:

- **Backend API** (`src/api/`, deployed via `docker compose` on the same host) — accepts SIWE-signed submissions, scores them against the deterministic corruption mask, and persists completed addresses to MongoDB.
- **End-user CLI** (`src/cli/`, distributed as `ghcr.io/node101-io/knidos-challenge:latest`) — runs on the user's machine; ships with the verification key pre-derived at image build time (bb's ultra_honk derivation peaks at ~6 GB RAM and is too heavy to push onto the end user's Docker Desktop), then presents 5 records for the user to verify against zkVerify on-chain and submits answers.

### Endpoints

- `GET  /api/health` — liveness
- `POST /api/submit` — `{ message, signature, answers[] }` → SIWE verify, score, upsert into `completed_addresses` on 5/5
- `GET  /api/completed?cursor=<id>` — paginated list of completed addresses for the knidos.xyz site to poll and sync. Returns `{ data: [{ address, completed_at }], next_cursor }`.

### Backend deploy

The API has no toolchain (no `bb`, no `nargo`, no `circuit.json`) — it ships from `packages/testnet-challange/Dockerfile.api` as a minimal Node + Hono image. MongoDB is shared with `zk-node` (Atlas in production, reads `MONGO_URI` from `.env`).

First-time:

```bash
docker compose up -d --build challenge-api
docker compose ps challenge-api
curl -fsS http://localhost:3001/api/health
```

Updates after a code change:

```bash
git pull
docker compose up -d --build --no-deps challenge-api
```

The service exposes `:3001` on the host. Point `knidos.node101.io/challange/*` at it via nginx (handled outside this repo).

### CLI image publish

`.github/workflows/testnet-challange-cli-image.yml` builds + pushes the multi-arch image (`linux/amd64`, `linux/arm64`) to `ghcr.io/node101-io/knidos-challenge` with `latest` + short-SHA tags. The workflow is **manual-only** (`workflow_dispatch`) — GitHub Actions doesn't run it on every push. Trigger it whenever you want a new image to ship:

```bash
gh workflow run testnet-challange-cli-image.yml
```

(or via the GitHub UI: Actions → "testnet-challange-cli image" → Run workflow.)

amd64 and arm64 build in parallel on their own native runners (`ubuntu-latest` and `ubuntu-24.04-arm`) — no QEMU emulation. The `vk-warmup` stage runs `nargo compile` + `bb write_vk` once per arch (~3 min, ~6 GB peak RAM — needs the GHA runner's headroom, won't fit on a default Docker Desktop). Final image is ~140 MB. A `merge` job stitches both single-arch images into a multi-arch manifest list. Uses the built-in `GITHUB_TOKEN` — no PAT or local docker login needed.


End-users only need Docker installed; no clone, no toolchain:

```bash
docker run --rm -it -p 7878:7878 ghcr.io/node101-io/knidos-challenge:latest
```

The CLI spins up a tiny local web server inside the container for the SIWE wallet-connect flow; `-p 7878:7878` forwards it so the user can open the URL in their browser. The port is hard-coded in the image (via `ENV KNIDOS_PORT` and `EXPOSE 7878`) so the same number appears on both sides of the colon.

### Refreshing the bundled records

`src/cli/data/records.json` is committed and frozen at image build time. To resample 5 random records from the last 7 days:

```bash
pnpm --filter testnet-challange snapshot-records
git commit -am "chore(challange): refresh records snapshot"
```

The dump source is `test.verificationrecords.json` at the repo root.

## Lint & Format

```bash
pnpm lint
pnpm format
```

## Tests

```bash
pnpm build       # type-checks the package via tsc
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

# Dev-only: keep the newest 3 zkTLS scheduler waves and prune older
# zkTLS tasks only when status is PENDING or QUEUED.
pnpm tasks:prune-waves
pnpm tasks:prune-waves --apply
pnpm tasks:prune-waves --keep-waves=5 --apply

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
```
