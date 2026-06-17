import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type EnvironmentConfiguration,
  waitForFunds,
} from '@midnight-ntwrk/testkit-js';
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

  return { wallet, providers, config };
}
