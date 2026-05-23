# Multi-stage, multi-arch image for the Knidos testnet challenge CLI.
# Built with `docker buildx build --platform linux/amd64,linux/arm64 ...`.

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
    chmod +x /usr/local/bin/bb

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
    chmod +x /usr/local/bin/nargo

# ───── Stage 3: apply our patch to noir_json_parser
# Stripping the submodule .git file first: a freshly-checked-out submodule
# has a .git *file* pointing at the parent repo's modules/, which doesn't
# exist inside the build context — `git init` would otherwise follow the
# dangling pointer.
FROM debian:trixie-slim AS patch
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
COPY noir_json_parser /noir_json_parser
COPY patches /patches
RUN cd /noir_json_parser \
 && rm -rf .git \
 && git init -q \
 && (git apply --check /patches/noir_json_parser.patch 2>/dev/null \
       && git apply /patches/noir_json_parser.patch \
       || echo "patch already applied")

# ───── Stage 4: pre-derive the verification key
# bb's ultra_honk VK derivation needs ~6 GB peak RAM, which OOM-kills on a
# default-config Docker Desktop VM. We run it once here (GHA runners have
# plenty of memory) and ship the resulting bytes in the runtime image.
# nargo+bb stay in this stage only — neither ends up in the final image.
FROM debian:trixie-slim AS vk-warmup
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git curl jq \
 && rm -rf /var/lib/apt/lists/*
COPY --from=bb-fetch    /usr/local/bin/bb    /usr/local/bin/bb
COPY --from=nargo-fetch /usr/local/bin/nargo /usr/local/bin/nargo
COPY circuit                       /app/circuit
COPY --from=patch /noir_json_parser /app/noir_json_parser
RUN cd /app/circuit \
 && nargo compile \
 && bb write_vk --scheme ultra_honk -b target/circuit.json -o target --output_format bytes

# ───── Stage 5: bundle CLI + collect production deps via `pnpm deploy`
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

# ───── Stage 6: install the few runtime deps tsup couldn't bundle
# tsup inlines every dep into dist/cli.js (~6 MB) except @inquirer/prompts
# (barrel re-exports) and @noble/{curves,hashes} (mixed CJS/ESM internals
# defeat esbuild's static analysis — they're used by our siwe-lite). Pull
# just those at their workspace-pinned versions so the runtime image
# carries ~10 MB of node_modules instead of the full deploy.
FROM node:22-trixie-slim AS cli-runtime-deps
WORKDIR /deps
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
COPY packages/testnet-challange/package.json /tmp/full.json
RUN jq '{name:"cli-runtime",version:"0.0.0",type:"module",dependencies:(.dependencies | with_entries(select(.key | IN("@inquirer/prompts","@noble/curves","@noble/hashes"))))}' /tmp/full.json > package.json \
 && npm install --omit=optional --no-package-lock --no-audit --no-fund --silent

# ───── Stage 7: runtime image (distroless — no shell, no apt, just node+glibc)
# With nargo+bb gone, we have nothing to shell out to at runtime, so we go
# back to the smallest viable base. The pre-derived VK from the warmup stage
# ships as a tiny file at /app/vk; cli.js reads + hashes it on demand.
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

COPY --from=vk-warmup         /app/circuit/target/vk                            /app/vk
COPY --from=builder           /repo/packages/testnet-challange/dist/cli.js     /app/dist/cli.js
COPY --from=builder           /repo/packages/testnet-challange/dist/cli.js.map /app/dist/cli.js.map
COPY --from=cli-runtime-deps  /deps/node_modules                                /app/node_modules
COPY --from=cli-runtime-deps  /deps/package.json                                /app/package.json

ENV NODE_ENV=production
# Pre-baked into the image so end-users don't need `-e KNIDOS_PORT=…` on the
# `docker run` line — they only need `-p 7878:7878` to forward the port.
ENV KNIDOS_PORT=7878
EXPOSE 7878
# Distroless's default ENTRYPOINT is `/nodejs/bin/node`. Passing the script
# path as CMD combines to `node /app/dist/cli.js`.
CMD ["/app/dist/cli.js"]
