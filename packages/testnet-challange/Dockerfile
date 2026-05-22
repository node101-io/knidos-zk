# Multi-stage, multi-arch image for the Knidos testnet challenge CLI.
# Built with `docker buildx build --platform linux/amd64,linux/arm64 ...` in CI.

# ───── Stage 1: fetch bb binary for target arch
FROM debian:trixie-slim AS bb-fetch
ARG TARGETARCH
ARG BB_VERSION=v0.84.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tar \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) BB_ASSET=barretenberg-amd64-linux.tar.gz ;; \
      arm64) BB_ASSET=barretenberg-arm64-linux.tar.gz ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fLsS -o /tmp/bb.tgz \
      "https://github.com/AztecProtocol/aztec-packages/releases/download/${BB_VERSION}/${BB_ASSET}"; \
    tar -xzf /tmp/bb.tgz -C /usr/local/bin/; \
    chmod +x /usr/local/bin/bb; \
    /usr/local/bin/bb --version

# ───── Stage 2: fetch nargo binary for target arch
FROM debian:trixie-slim AS nargo-fetch
ARG TARGETARCH
ARG NARGO_VERSION=v1.0.0-beta.6
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tar \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) NARGO_ASSET=nargo-x86_64-unknown-linux-gnu.tar.gz ;; \
      arm64) NARGO_ASSET=nargo-aarch64-unknown-linux-gnu.tar.gz ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fLsS -o /tmp/nargo.tgz \
      "https://github.com/noir-lang/noir/releases/download/${NARGO_VERSION}/${NARGO_ASSET}"; \
    tar -xzf /tmp/nargo.tgz -C /usr/local/bin/; \
    chmod +x /usr/local/bin/nargo; \
    /usr/local/bin/nargo --version

# ───── Stage 3: warm the nargo git cache by compiling once
# This populates ~/.nargo/git/ with sha256/poseidon/noir_sort sources so
# runtime compile doesn't need network. The resulting target/ is discarded;
# user always re-compiles at CLI start.
FROM debian:trixie-slim AS warmup
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
COPY --from=nargo-fetch /usr/local/bin/nargo /usr/local/bin/nargo
COPY circuit /circuit
COPY noir_json_parser /noir_json_parser
COPY patches /patches
# Apply our patch to noir_json_parser if not already applied (idempotent).
RUN cd /noir_json_parser \
 && git init -q \
 && (git apply --check /patches/noir_json_parser.patch 2>/dev/null \
       && git apply /patches/noir_json_parser.patch \
       || echo "patch already applied")
WORKDIR /circuit
RUN nargo compile && rm -rf /circuit/target

# ───── Stage 4: bundle CLI + collect production deps via `pnpm deploy`
FROM node:22-trixie-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json .npmrc ./
COPY packages/zk-node/package.json packages/zk-node/
COPY packages/testnet-challange/package.json packages/testnet-challange/
COPY packages/testnet-challange/tsconfig.json packages/testnet-challange/tsup.config.ts packages/testnet-challange/vite.config.ts packages/testnet-challange/
COPY packages/testnet-challange/src packages/testnet-challange/src
COPY packages/testnet-challange/sign-page packages/testnet-challange/sign-page

ENV npm_config_ignore_scripts=true
RUN pnpm install --frozen-lockfile --filter testnet-challange
RUN pnpm --filter testnet-challange build
RUN pnpm --filter testnet-challange --prod deploy --legacy /out

# ───── Stage 5: runtime image
FROM node:22-trixie-slim
WORKDIR /app

COPY --from=bb-fetch    /usr/local/bin/bb    /usr/local/bin/bb
COPY --from=nargo-fetch /usr/local/bin/nargo /usr/local/bin/nargo

# Noir source: user compiles this at CLI start (`nargo compile`) so the
# whole circuit.json → vk derivation chain runs on their machine. Take the
# patched copy from the warmup stage so noir_json_parser already has the
# upstream fix applied.
COPY --from=warmup /circuit           /app/circuit
COPY --from=warmup /noir_json_parser  /app/noir_json_parser

# Cached git deps (sha256 / poseidon / noir_sort) so `nargo compile` works
# offline. Identical content to what `nargo` would fetch fresh from GitHub —
# users can verify by running `nargo compile` themselves locally.
COPY --from=warmup /root/.nargo /root/.nargo

COPY --from=builder /out/dist /app/dist
COPY --from=builder /out/node_modules /app/node_modules
COPY --from=builder /out/package.json /app/package.json

ENV NODE_ENV=production
ENTRYPOINT ["node", "/app/dist/cli.js"]
