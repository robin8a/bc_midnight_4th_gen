import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  type MidnightProvider,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { makeWasmProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import {
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  createKeystore,
  mergeWalletEntries,
  type FacadeState,
} from '@midnight-ntwrk/wallet-sdk';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  WalletFactory,
  WalletSeeds,
} from '@midnight-ntwrk/testkit-js';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };

type WalletConfiguration = {
  indexerClientConnection: {
    indexerHttpUrl: string;
    indexerWsUrl: string;
  };
  provingServerUrl: URL;
  networkId: string;
  relayURL: URL;
  txHistoryStorage: InMemoryTransactionHistoryStorage;
  costParameters: {
    ledgerParams?: ReturnType<typeof LedgerParameters.initialParameters>;
    additionalFeeOverhead?: bigint;
    feeBlocksMargin: number;
  };
};

function mapEnvironmentToConfiguration(env: EnvironmentConfiguration): WalletConfiguration {
  return {
    indexerClientConnection: {
      indexerHttpUrl: env.indexer,
      indexerWsUrl: env.indexerWS,
    },
    provingServerUrl: new URL(env.proofServer),
    networkId: env.walletNetworkId,
    relayURL: new URL(env.nodeWS),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      WalletEntrySchema,
      mergeWalletEntries,
    ),
    costParameters: {
      feeBlocksMargin: 5,
    },
  };
}

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnboundTransaction,
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );
    return await this.wallet.finalizeRecipe(recipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    const seeds =
      secret.kind === 'mnemonic'
        ? WalletSeeds.fromMnemonic(secret.value)
        : WalletSeeds.fromMasterSeed(secret.value);

    const config = mapEnvironmentToConfiguration(env);
    config.costParameters = {
      ledgerParams: dustOptions.ledgerParams,
      additionalFeeOverhead: dustOptions.additionalFeeOverhead,
      feeBlocksMargin: dustOptions.feeBlocksMargin,
    };

    const keystore = createKeystore(seeds.unshielded, env.walletNetworkId);
    const shieldedWallet = WalletFactory.createShieldedWallet(config, seeds.shielded);
    const unshieldedWallet = WalletFactory.createUnshieldedWallet(config, keystore);
    const dustWallet = WalletFactory.createDustWallet(config, seeds.dust, dustOptions);

    // Wallet SDK's HTTP prover (Effect fetch) can fail with transport errors on
    // large /prove payloads on some Node setups. WASM proving is more reliable
    // locally. Contract circuit proofs still use httpClientProofProvider.
    const useWasmWalletProver = process.env['MIDNIGHT_WALLET_WASM_PROVER'] !== '0';
    const wallet = await WalletFacade.init({
      configuration: config,
      shielded: () => shieldedWallet,
      unshielded: () => unshieldedWallet,
      dust: () => dustWallet,
      ...(useWasmWalletProver
        ? { provingService: () => makeWasmProvingService() }
        : {}),
    });

    logger.info(
      `Wallet built from ${secret.kind}; master seed: ${seeds.masterSeed.slice(0, 8)}... ` +
        `(wallet prover: ${useWasmWalletProver ? 'wasm' : 'http'})`,
    );

    return new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<void> {
  logger.info('Syncing wallet...');
  let emissionCount = 0;
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.state.progress);
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${shielded}, unshielded=${unshielded}, dust=${dust}`,
        );
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.state.progress) &&
          isProgressStrictlyComplete(state.dust.state.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () =>
              new Error(
                `Wallet sync timeout after ${timeout}ms (${emissionCount} emissions received)`,
              ),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
      Rx.map(() => undefined),
    ),
  );
}
