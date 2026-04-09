# knidos-zk

Zero-knowledge proof pipeline for verifying Hyperliquid trading data. Combines zkTLS attestation, Noir circuit proving, and on-chain verification via zkVerify.

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **nargo** v1.0.0-beta.6 (Noir compiler)

### Installing nargo

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash
noirup --version 1.0.0-beta.6
```

Verify installation:

```bash
nargo --version
```

## Setup

```bash
pnpm install
```

Copy the environment template and fill in the required values:

```bash
cp .env.example .env
```

## Build & Run

```bash
pnpm build
pnpm node
```

For development with watch mode:

```bash
pnpm dev:node
```

## Lint & Format

```bash
pnpm lint
pnpm format
```
