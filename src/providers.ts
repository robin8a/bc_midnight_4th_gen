import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';

export type InceptionDeedCircuits = 'storeMessage' | 'redeemDeed';

export type InceptionDeedProviders = MidnightProviders<
  InceptionDeedCircuits,
  string,
  Record<string, never>
>;

export function privateStateStoreNameForNetwork(network: string): string {
  return `inception-deed-${network}`;
}

export function buildProviders(
  wallet: MidnightWalletProvider,
  zkConfigPath: string,
  config: NetworkConfig,
  privateStateStoreName?: string,
): InceptionDeedProviders {
  const storeName =
    privateStateStoreName ?? privateStateStoreNameForNetwork(config.networkId);
  const zkConfigProvider = new NodeZkConfigProvider<InceptionDeedCircuits>(zkConfigPath);

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName,
      privateStoragePasswordProvider: () => 'Inception-Deed-Password',
      accountId: wallet.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}
