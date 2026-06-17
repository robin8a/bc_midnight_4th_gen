# Midnight Inception

A minimal [Midnight Network](https://midnight.network/) smart contract: **pay 1 NIGHT, receive 1 unshielded deed token**, plus a Hello World public message store.

## Quick start

```bash
# Use nvm Node 22 (22.19+ required)
nvm install 22
nvm use 22

# Prerequisites: Docker, Compact toolchain
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update

npm install
npm run compile
npm run env:up          # first boot: proof server downloads ZK keys (several minutes)
npm run test:local
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

## Troubleshooting

### `Failed to connect to Proof Server` / `Transport error (POST .../prove)`

This means ZK proof generation failed. Your log showed `Proof server is ready` on **GET /** only — the server can still be downloading ZK keys on first boot.

**Fix:**

```bash
nvm use 22              # must be v22.19+ (you had v22.14.0)
node --version

npm run env:up
# Wait until this returns HTTP 400 (not connection error):
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:6300/prove -d ''

npm run deploy
```

`npm run deploy` now waits until **POST /prove** responds (not just GET /) and retries on transport errors.

If it still fails after ~3 minutes:

```bash
npm run env:down
npm run env:up
# watch proof-server logs until you see "listening on: 0.0.0.0:6300"
docker compose logs -f proof-server
```

## Documentation

- [Midnight getting started](https://docs.midnight.network/getting-started/hello-world)
- [Token transfers example](https://docs.midnight.network/examples/contracts/token-transfers)
