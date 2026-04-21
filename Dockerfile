# syntax=docker/dockerfile:1.7

# ======================================
# build-base: shared base for stages that need build tools
# Has: node, pnpm, git, curl, python3, make, g++
# Used by: toolchain, deps, builder
# ======================================
FROM node:22-bookworm-slim AS build-base
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
COPY tsconfig.json ./
COPY src ./src
RUN pnpm exec tsc \
 && pnpm prune --prod --ignore-scripts

# ======================================
# runtime: minimal image, no build tools, non-root user
# Runtime deps only: git (for nargo git-based deps), jq (for bb), ca-certs
# ======================================
FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH="/opt/nargo/bin:/opt/bb:${PATH}" \
    BB_PATH="/opt/bb/bb"
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates git jq \
 && rm -rf /var/lib/apt/lists/*

# Toolchain binaries to a world-readable location so non-root user can exec them
COPY --from=toolchain /root/.nargo /opt/nargo
COPY --from=toolchain /root/.bb /opt/bb

# App directory owned by built-in `node` user (UID 1000)
RUN mkdir -p /app && chown node:node /app
WORKDIR /app

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/noir_json_parser ./noir_json_parser
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --chown=node:node circuit ./circuit

USER node

EXPOSE 3000

CMD ["node", "dist/src/app.js"]
