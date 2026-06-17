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
  const message = process.argv[2] ?? 'Hello World!';
  const { wallet, providers } = await setupWalletAndProviders();

  try {
    logger.info(`Storing message: "${message}"`);
    await submitCallTx<Contract, 'storeMessage'>(providers, {
      compiledContract: CompiledInceptionDeedContract,
      contractAddress: deployment.contractAddress,
      privateStateId: deployment.privateStateId,
      circuitId: 'storeMessage',
      args: [message],
    });
    logger.info('Message stored successfully.');
  } finally {
    await wallet.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
