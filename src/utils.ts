import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type EnvironmentConfiguration,
  waitForFunds,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import pino from 'pino';

import { getConfig } from './config.js';
import {
  MidnightWalletProvider,
  syncWallet,
  type WalletSecret,
} from './wallet.js';
import { buildProviders, type InceptionDeedProviders } from './providers.js';
import { zkConfigPath } from '../contracts/index.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

export const PRIVATE_STATE_ID = 'InceptionDeedPrivateState';
export const LOCAL_ALICE_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

export const DEPLOYMENT_FILE = resolve(process.cwd(), 'deployment.json');

export type DeploymentInfo = {
  contractAddress: ContractAddress;
  privateStateId: string;
  network: string;
};

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

export function resolveSecret(network: string): WalletSecret {
  if (network === 'local') {
    return { kind: 'seed', value: LOCAL_ALICE_SEED };
  }

  const upper = network.toUpperCase();
  const mnemonicEnv = `MIDNIGHT_${upper}_MNEMONIC`;
  const seedEnv = `MIDNIGHT_${upper}_SEED`;
  const mnemonic = process.env[mnemonicEnv]?.trim().replace(/\s+/g, ' ');
  const seedHex = process.env[seedEnv]?.trim();

  if (mnemonic && seedHex) {
    throw new Error(`Set only one of ${mnemonicEnv} or ${seedEnv} (both are defined).`);
  }
  if (mnemonic) {
    return { kind: 'mnemonic', value: mnemonic };
  }
  if (seedHex) {
    if (!/^[0-9a-fA-F]+$/.test(seedHex) || seedHex.length % 2 !== 0) {
      throw new Error(`${seedEnv} must be a hex string of even length (no 0x prefix).`);
    }
    return { kind: 'seed', value: seedHex };
  }
  throw new Error(
    `Either ${mnemonicEnv} or ${seedEnv} is required for network '${network}'.`,
  );
}

export function loadDeployment(): DeploymentInfo {
  if (!existsSync(DEPLOYMENT_FILE)) {
    throw new Error(
      `Missing ${DEPLOYMENT_FILE}. Run "yarn deploy" first.`,
    );
  }
  return JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) as DeploymentInfo;
}

export function saveDeployment(info: DeploymentInfo): void {
  writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(info, null, 2)}\n`);
}

export async function waitForProofServer(
  proofServerUrl: string,
  maxAttempts = 90,
  delayMs = 2000,
): Promise<void> {
  const base = proofServerUrl.replace(/\/$/, '');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const health = await fetch(`${base}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!health.ok) {
        throw new Error(`health check returned ${health.status}`);
      }

      // GET / only proves the HTTP port is open. The proof server downloads
      // large ZK artifacts on first boot; /prove can fail with transport
      // errors until that finishes. A 4xx response means /prove is accepting
      // connections and parsing requests.
      const prove = await fetch(`${base}/prove`, {
        method: 'POST',
        body: new Uint8Array([0]),
        signal: AbortSignal.timeout(15000),
      });
      if (prove.status >= 400 && prove.status < 500) {
        logger.info('Proof server is ready (/prove accepting requests)');
        return;
      }
      throw new Error(`/prove returned ${prove.status}`);
    } catch (err: unknown) {
      const code =
        (err as { cause?: { code?: string }; code?: string })?.cause?.code ||
        (err as { code?: string })?.code ||
        '';
      const retriable =
        code === 'ECONNREFUSED' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'UND_ERR_SOCKET' ||
        code === 'ETIMEDOUT' ||
        (err instanceof Error && err.message.includes('/prove returned'));

      if (!retriable && attempt > 1) {
        throw err;
      }
    }

    if (attempt < maxAttempts) {
      logger.info(
        `Waiting for proof server (downloading ZK keys on first boot)... (${attempt}/${maxAttempts})`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw new Error(
    `Proof server not ready at ${proofServerUrl}. ` +
      'Run: npm run env:up — first boot can take several minutes.',
  );
}

export async function ensureDustRegistration(
  wallet: MidnightWalletProvider,
): Promise<void> {
  const state = await Rx.firstValueFrom(
    wallet.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const unregistered = state.unshielded.availableCoins.filter(
    (coin: { meta?: { registeredForDustGeneration?: boolean } }) =>
      !coin.meta?.registeredForDustGeneration,
  );

  if (unregistered.length > 0) {
    logger.info(`Registering ${unregistered.length} NIGHT UTXO(s) for DUST...`);
    const recipe = await wallet.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      wallet.unshieldedKeystore.getPublicKey(),
      (payload) => wallet.unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.wallet.finalizeRecipe(recipe);
    await wallet.wallet.submitTransaction(finalized);
  }

  const dustBalance = state.dust.balance(new Date());
  if (dustBalance === 0n) {
    logger.info('Waiting for DUST balance...');
    await Rx.firstValueFrom(
      wallet.wallet.state().pipe(
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    );
  }

  // Fresh devnet: wall-clock DUST projection can lag block time by ~1 block.
  await new Promise((r) => setTimeout(r, 6000));
}

function deployErrorText(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      if ('cause' in current && current.cause !== undefined) {
        current = current.cause;
        continue;
      }
      break;
    }
    if (typeof current === 'object') {
      parts.push(JSON.stringify(current));
      break;
    }
    parts.push(String(current));
    break;
  }

  return parts.join(' ');
}

export function assertNodeVersion(minMajor = 22, minMinor = 19, minPatch = 0): void {
  const match = process.version.match(/^v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const ok =
    major > minMajor ||
    (major === minMajor && minor > minMinor) ||
    (major === minMajor && minor === minMinor && patch >= minPatch);

  if (!ok) {
    throw new Error(
      `Node ${process.version} is too old. Use Node >=${minMajor}.${minMinor}.${minPatch} ` +
        '(run: nvm install 22 && nvm use 22).',
    );
  }
}

export function isRetriableDeployError(err: unknown): boolean {
  const full = deployErrorText(err).toLowerCase();
  return (
    full.includes('not enough dust') ||
    full.includes('insufficient funds') ||
    full.includes('failed to connect to proof server') ||
    full.includes('transport error')
  );
}

export async function setupWalletAndProviders(): Promise<{
  wallet: MidnightWalletProvider;
  providers: InceptionDeedProviders;
  config: ReturnType<typeof getConfig>;
}> {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  const config = getConfig();
  const secret = resolveSecret(network);
  const isRemote = config.faucet !== '';

  setNetworkId(config.networkId);

  const envConfig: EnvironmentConfiguration = {
    walletNetworkId: config.networkId,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  const wallet = await MidnightWalletProvider.build(logger, envConfig, secret);
  await wallet.start();

  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );
  await syncWallet(logger, wallet.wallet, syncTimeoutMs);

  if (isRemote) {
    const nightBalance = await waitForFunds(
      wallet.wallet,
      envConfig,
      true,
      wallet.unshieldedKeystore,
    );
    logger.info(`Wallet NIGHT balance on '${network}': ${nightBalance}`);
  }

  const providers = buildProviders(wallet, zkConfigPath, config);
  logger.info(`Providers initialized on '${network}'.`);

  await waitForProofServer(config.proofServer);
  await ensureDustRegistration(wallet);

  return { wallet, providers, config };
}
