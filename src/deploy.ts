import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledInceptionDeedContract } from '../contracts/index.js';
import {
  logger,
  PRIVATE_STATE_ID,
  saveDeployment,
  setupWalletAndProviders,
} from './utils.js';

async function main(): Promise<void> {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  const { wallet, providers } = await setupWalletAndProviders();

  try {
    logger.info('Deploying inception-deed contract...');
    const deployed = await deployContract(providers, {
      compiledContract: CompiledInceptionDeedContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });

    const contractAddress = deployed.deployTxData.public.contractAddress;
    saveDeployment({
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      network,
    });

    logger.info(`Contract deployed at: ${contractAddress}`);
    logger.info(`Saved deployment info to deployment.json`);
  } finally {
    await wallet.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
