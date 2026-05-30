# syntax=docker/dockerfile:1.7

# ======================================
# build-base: shared base for stages that need build tools
# Has: node, pnpm, git, curl, python3, make, g++
# Used by: toolchain, deps, builder
# ======================================
FROM node:24-trixie-slim AS build-base
ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 make g++ \
 && corepack enable \
 && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ======================================
# toolchain: bb + nargo binaries (isolated so they stay cached across code changes)
# ======================================
FROM build-base AS toolchain
SHELL ["/bin/bash", "-lc"]
RUN curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash \
 && /root/.nargo/bin/noirup -v 1.0.0-beta.6
RUN curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash \
 && /root/.bb/bbup -v 0.84.0

# ======================================
# deps: pnpm install (with native module compilation)
# ======================================
FROM build-base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/zk-node/package.json ./packages/zk-node/package.json
COPY patches ./patches
COPY noir_json_parser ./noir_json_parser
RUN test -f noir_json_parser/Nargo.toml \
    || (echo "ERROR: noir_json_parser submodule empty. Run 'git submodule update --init' before docker build." && exit 1)
# --ignore-scripts bypasses postinstall (which needs .git); pnpm rebuild then
# runs each dependency's install/postinstall so native modules (node-gyp,
# @primuslabs/network-core-sdk) still compile.
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile --ignore-scripts \
 && pnpm rebuild

# ======================================
# builder: TypeScript compile + prune devDeps
# ======================================
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/zk-node/tsconfig.json ./packages/zk-node/tsconfig.json
COPY packages/zk-node/src ./packages/zk-node/src
# Primus ships the native addon source in the package tarball, but its
# install script only auto-builds on Ubuntu/macOS. Our image is Debian,
# so we must rebuild the addon explicitly and fail the image build if
# the `.node` artifact is still missing. We resolve the SDK path from
# inside the package directory because workspace symlinks for that dep
# live under packages/zk-node/node_modules in pnpm's workspace layout.
RUN pnpm --filter zk-node exec tsc \
 && primus_sdk_dir="$(cd packages/zk-node && node -e "const path=require('path'); process.stdout.write(path.dirname(require.resolve('@primuslabs/network-core-sdk/package.json')));")" \
 && node_gyp_bin="$(cd packages/zk-node && node -e "process.stdout.write(require.resolve('node-gyp/bin/node-gyp.js'))")" \
 && cd "$primus_sdk_dir" \
 && node "$node_gyp_bin" rebuild \
 && test -f build/Release/primus-zktls-native.node

# ======================================
# runtime: minimal image, no build tools, non-root user
# Runtime deps: curl (bb downloads SRS data on first run), git (nargo git deps),
# jq (bb output parsing), ca-certs
# ======================================
FROM node:24-trixie-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH="/opt/nargo/bin:/opt/bb:${PATH}" \
    BB_PATH="/opt/bb/bb"
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq \
 && rm -rf /var/lib/apt/lists/*

# Toolchain binaries to a world-readable location so non-root user can exec them
COPY --from=toolchain /root/.nargo /opt/nargo
COPY --from=toolchain /root/.bb /opt/bb

# App directory owned by built-in `node` user (UID 1000)
RUN mkdir -p /app && chown node:node /app
WORKDIR /app

COPY --from=builder --chown=node:node /app/packages/zk-node/dist ./packages/zk-node/dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/zk-node/node_modules ./packages/zk-node/node_modules
COPY --from=builder --chown=node:node /app/noir_json_parser ./noir_json_parser
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/packages/zk-node/package.json ./packages/zk-node/package.json
COPY --chown=node:node circuit ./circuit

# Pre-create the circuit/target mount point so the named volume inherits
# node:node ownership on first mount (otherwise volume defaults to root:root
# and nargo compile hits EACCES trying to write the compiled artifact).
RUN mkdir -p /app/circuit/target && chown node:node /app/circuit/target

USER node

EXPOSE 3000

CMD ["node", "packages/zk-node/dist/src/app.js"]
