# Midnight Inception

A minimal [Midnight Network](https://midnight.network/) smart contract: **pay 1 NIGHT, receive 1 unshielded deed token**, plus a Hello World public message store.

## Quick start

```bash
# Prerequisites: Node.js 22+, Docker, Compact toolchain
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update

yarn install   # or: npm install
yarn compile   # or: npm run compile
yarn env:up
yarn test:local
```

## CLI scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile `contracts/inception-deed.compact` |
| `npm run env:up` | Start local devnet (node, indexer, proof server) |
| `npm run deploy` | Deploy contract → writes `deployment.json` |
| `npm run store-message` | Store a message on-chain (default: `Hello World!`) |
| `npm run redeem` | Pay 1 NIGHT and mint 1 deed to your wallet |

## Project layout

```
contracts/inception-deed.compact   # Compact smart contract
src/deploy.ts                    # Deploy script
src/store-message.ts             # Store message circuit
src/redeem.ts                    # Redeem deed circuit
src/test/inception.test.ts       # Local integration tests
_inception/README.md             # Design notes and protocol context
```

## Design note: NIGHT vs DUST

The original inception idea referenced sending **DUST** to the contract. On Midnight, **DUST is non-transferable fee capacity** (generated from holding NIGHT). This project implements the payment as **1 NIGHT** (native unshielded token). DUST is consumed automatically when you submit transactions.

See [_inception/README.md](_inception/README.md) for full details.

## Documentation

- [Midnight getting started](https://docs.midnight.network/getting-started/hello-world)
- [Token transfers example](https://docs.midnight.network/examples/contracts/token-transfers)
