import { encodeUserAddress } from '@midnight-ntwrk/ledger-v8';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  CompiledInceptionDeedContract,
  Contract,
} from '../contracts/index.js';
import {
  loadDeployment,
  logger,
  setupWalletAndProviders,
} from './utils.js';

async function main(): Promise<void> {
  const deployment = loadDeployment();
  const { wallet, providers } = await setupWalletAndProviders();
  const buyer = { bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()) };

  try {
    logger.info(`Redeeming deed for buyer: ${wallet.unshieldedKeystore.getBech32Address()}`);
    await submitCallTx<Contract, 'redeemDeed'>(providers, {
      compiledContract: CompiledInceptionDeedContract,
      contractAddress: deployment.contractAddress,
      privateStateId: deployment.privateStateId,
      circuitId: 'redeemDeed',
      args: [buyer],
    });
    logger.info('Deed redeemed successfully (1 NIGHT paid, 1 unshielded deed minted).');
  } finally {
    await wallet.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
