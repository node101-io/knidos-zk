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

Production logs always go to `stdout`. If `AXIOM_TOKEN` and `AXIOM_DATASET` are both set, production also ships the same JSON logs to Axiom using the official Pino transport. The recommended dataset name is `knidos-zk-logs`.

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

## Production deployment (Docker Swarm)

Production uses Docker's built-in Swarm mode on a single node. Swarm gives us zero-downtime rolling updates for the HTTP `server` (via `update_config.order: start-first` with healthchecks) while keeping the same `docker-compose.yml` we use for builds. MongoDB is external (Atlas); the stack runs `node` (daemon), `server` (HTTP), and a local `redis`. `nargo`, `bb`, Node, and pnpm are baked into the image — Docker engine (with compose plugin) and `jq` are the only host prerequisites (jq is used by the one-time host-setup script below).

### First-time deploy

```bash
git clone <repo> /root/knidos-zk && cd /root/knidos-zk
git submodule update --init

# One-time host DNS fix for systemd-resolved + Docker overlay compat.
# Idempotent — safe to re-run. See host-setup.sh for details.
sudo ./host-setup.sh

cp .env.example .env   # fill in Atlas MONGO_URI, Primus keys, etc.

docker swarm init                                      # one-time, enables swarm mode
docker compose build                                   # build image from Dockerfile
docker stack deploy -c docker-compose.yml knidos       # deploy stack
docker stack services knidos                           # should show redis + node + server running
```

If you want Axiom shipping in production, add these to the host `.env` before deploy:

```bash
AXIOM_TOKEN=...
AXIOM_DATASET=knidos-zk-logs
```

Create the dataset as an `Events` dataset and generate an ingest-only API token in Axiom. A simple first monitor in the Axiom UI is `service == "knidos-zk"` with `severity in ["ERROR","CRITICAL"]`.

> **`.env` quoting gotcha**: Docker Swarm's `env_file` parser does **not** strip surrounding double quotes from values (unlike `docker compose`). Write values unquoted — e.g. `PRIMUS_PRIVATE_KEY=0xabc...`, not `PRIMUS_PRIVATE_KEY="0xabc..."`. Quick sweep to clean an existing `.env`:
>
> ```bash
> sed -i 's/="\(.*\)"$/=\1/' .env   # macOS: sed -i '' '...'
> ```

Make sure the server's public IP is whitelisted in Atlas Network Access.

### Updating after a code change

```bash
cd /root/knidos-zk
git pull
git submodule update --init   # only if submodule changed

docker compose build                                   # ~30–60s with layer cache
docker stack deploy -c docker-compose.yml knidos       # rolling update
```

Swarm replaces each service's tasks with the new image. The `server` uses `order: start-first` — the new container boots, passes its healthcheck, and only then does the old one exit, giving zero observable downtime on port 3000. `node` (daemon) has a brief gap (~30s Noir warmup) that's invisible to clients since it has no inbound traffic.

### Rollback

```bash
git checkout <previous-sha>
docker compose build
docker stack deploy -c docker-compose.yml knidos
```

Or revert a single service to its previous image:

```bash
docker service rollback knidos_server
```

### Operational commands

```bash
docker stack services knidos                           # service status + replica counts
docker stack ps knidos                                 # individual tasks (containers)
docker service logs -f knidos_node                     # daemon logs (wide events)
docker service logs -f knidos_server                   # HTTP server logs
docker service logs --since 1h knidos_node | jq 'select(.event=="task.attempt")'
docker service update --force knidos_node              # restart single service
docker stack rm knidos                                 # tear down entire stack
```

Docker engine is enabled on boot (`systemctl enable docker`). Swarm services are restarted automatically by the swarm manager on any exit — no PM2 or dedicated systemd unit required.

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
