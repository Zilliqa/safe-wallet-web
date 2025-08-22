import useWallet from '@/hooks/wallets/useWallet'
import { useWeb3ReadOnly } from '@/hooks/wallets/web3'
import { getSpendingLimitContract } from '@/services/contracts/spendingLimitContracts'
import useAsync from '@safe-global/utils/hooks/useAsync'
import { type SpendingLimitTxParams } from '@/components/tx-flow/flows/TokenTransfer/ReviewSpendingLimitTx'
import useChainId from '@/hooks/useChainId'
import useSafeInfo from './useSafeInfo'
import { type JsonRpcProvider } from 'ethers'

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
const getConservativeGasEstimate = (): bigint => {
  // Base gas for spending limit transaction
  const baseGas = 21000n

  // Add gas for complex contract interaction (spending limit execution)
  const contractGas = 100000n

  // Add safety buffer
  const totalGas = baseGas + contractGas

  return (totalGas * BigInt(Math.floor(SAFETY_BUFFER_MULTIPLIER * 100))) / BigInt(100)
}

// Enhanced gas estimation with retry logic
const estimateGasWithRetry = async (
  provider: JsonRpcProvider,
  contract: any,
  data: string,
  walletAddress: string,
): Promise<bigint> => {
  // Try RPC estimation with retries
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const gasLimit = await provider.estimateGas({
        to: await contract.getAddress(),
        from: walletAddress,
        data,
      })

      // Add safety buffer
      return (BigInt(gasLimit.toString()) * BigInt(Math.floor(SAFETY_BUFFER_MULTIPLIER * 100))) / BigInt(100)
    } catch (error) {
      console.warn(`Gas estimation attempt ${attempt + 1} failed:`, error)

      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(getRetryDelay(attempt))
      }
    }
  }

  // Use conservative estimation as fallback
  console.log('Using conservative gas estimation as fallback')
  return getConservativeGasEstimate()
}

const useSpendingLimitGas = (params: SpendingLimitTxParams) => {
  const chainId = useChainId()
  const provider = useWeb3ReadOnly()
  const wallet = useWallet()
  const { safe } = useSafeInfo()

  const [gasLimit, gasLimitError, gasLimitLoading] = useAsync<bigint | undefined>(async () => {
    if (!provider || !wallet || !safe.modules?.length) return

    const contract = getSpendingLimitContract(chainId, safe.modules, provider)

    const data = contract.interface.encodeFunctionData('executeAllowanceTransfer', [
      params.safeAddress,
      params.token,
      params.to,
      params.amount,
      params.paymentToken,
      params.payment,
      params.delegate,
      params.signature,
    ])

    return estimateGasWithRetry(provider, contract, data, wallet.address)
  }, [provider, wallet, chainId, params, safe.modules])

  return { gasLimit, gasLimitError, gasLimitLoading }
}

export default useSpendingLimitGas
