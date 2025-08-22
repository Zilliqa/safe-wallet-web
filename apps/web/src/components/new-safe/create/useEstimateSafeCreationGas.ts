import { useWeb3ReadOnly } from '@/hooks/wallets/web3'
import useWallet from '@/hooks/wallets/useWallet'
import useAsync from '@safe-global/utils/hooks/useAsync'
import { useCurrentChain } from '@/hooks/useChains'
import { estimateSafeCreationGas } from '@/components/new-safe/create/logic'
import { type JsonRpcProvider } from 'ethers'
import type { SafeVersion } from '@safe-global/types-kit'
import type { UndeployedSafeProps } from '@safe-global/utils/features/counterfactual/store/types'

// Retry configuration for gas estimation
const RETRY_ATTEMPTS = 3
const RETRY_DELAY_BASE = 1000 // 1 second
const SAFETY_BUFFER_MULTIPLIER = 1.2 // 20% safety buffer

// Exponential backoff delay
const getRetryDelay = (attempt: number): number => {
  return RETRY_DELAY_BASE * Math.pow(2, attempt)
}

// Sleep utility
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Conservative gas estimation as fallback
const getConservativeSafeCreationGas = (): bigint => {
  // Base gas for Safe creation
  const baseGas = 21000n

  // Add gas for Safe deployment (proxy + implementation)
  const deploymentGas = 200000n

  // Add gas for initial setup (owners, threshold, etc.)
  const setupGas = 50000n

  // Add safety buffer
  const totalGas = baseGas + deploymentGas + setupGas

  return (totalGas * BigInt(Math.floor(SAFETY_BUFFER_MULTIPLIER * 100))) / BigInt(100)
}

// Enhanced gas estimation with retry logic
const estimateSafeCreationGasWithRetry = async (
  chain: any,
  provider: JsonRpcProvider,
  from: string,
  undeployedSafe: UndeployedSafeProps,
  safeVersion?: SafeVersion,
): Promise<bigint> => {
  // Try RPC estimation with retries
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const gasLimit = await estimateSafeCreationGas(chain, provider, from, undeployedSafe, safeVersion)

      // Add safety buffer
      return (BigInt(gasLimit.toString()) * BigInt(Math.floor(SAFETY_BUFFER_MULTIPLIER * 100))) / BigInt(100)
    } catch (error) {
      console.warn(`Safe creation gas estimation attempt ${attempt + 1} failed:`, error)

      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(getRetryDelay(attempt))
      }
    }
  }

  // Use conservative estimation as fallback
  console.log('Using conservative Safe creation gas estimation as fallback')
  return getConservativeSafeCreationGas()
}

export const useEstimateSafeCreationGas = (
  undeployedSafe: UndeployedSafeProps | undefined,
  safeVersion?: SafeVersion,
): {
  gasLimit?: bigint
  gasLimitError?: Error
  gasLimitLoading: boolean
} => {
  const web3ReadOnly = useWeb3ReadOnly()
  const chain = useCurrentChain()
  const wallet = useWallet()

  const [gasLimit, gasLimitError, gasLimitLoading] = useAsync<bigint>(() => {
    if (!wallet?.address || !chain || !web3ReadOnly || !undeployedSafe) return

    return estimateSafeCreationGasWithRetry(chain, web3ReadOnly, wallet.address, undeployedSafe, safeVersion)
  }, [wallet?.address, chain, web3ReadOnly, undeployedSafe, safeVersion])

  return { gasLimit, gasLimitError, gasLimitLoading }
}
