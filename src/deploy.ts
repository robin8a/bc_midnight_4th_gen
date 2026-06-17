import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledInceptionDeedContract } from '../contracts/index.js';
import {
  assertNodeVersion,
  isRetriableDeployError,
  logger,
  PRIVATE_STATE_ID,
  saveDeployment,
  setupWalletAndProviders,
} from './utils.js';

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 5000;

async function main(): Promise<void> {
  assertNodeVersion();
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  const { wallet, providers } = await setupWalletAndProviders();

  try {
    logger.info('Deploying inception-deed contract...');

    let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        deployed = await deployContract(providers, {
          compiledContract: CompiledInceptionDeedContract,
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: {},
        });
        break;
      } catch (err) {
        if (!isRetriableDeployError(err) || attempt === MAX_RETRIES) {
          throw err;
        }
        logger.warn(
          `Deploy attempt ${attempt}/${MAX_RETRIES} failed (DUST/proof-server timing). Retrying in ${RETRY_DELAY_MS / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    if (!deployed) {
      throw new Error('Deployment failed after all retries');
    }

    const contractAddress = deployed.deployTxData.public.contractAddress;
    saveDeployment({
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      network,
    });

    logger.info(`Contract deployed at: ${contractAddress}`);
    logger.info('Saved deployment info to deployment.json');
  } finally {
    await wallet.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
