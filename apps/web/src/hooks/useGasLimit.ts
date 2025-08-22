import { SafeProvider } from '@safe-global/protocol-kit'
import { useEffect } from 'react'
import type Safe from '@safe-global/protocol-kit'
import { encodeSignatures } from '@/services/tx/encodeSignatures'
import type { SafeTransaction } from '@safe-global/types-kit'
import useAsync from '@safe-global/utils/hooks/useAsync'
import useChainId from '@/hooks/useChainId'
import { useWeb3ReadOnly } from '@/hooks/wallets/web3'
import chains from '@/config/chains'
import { useSigner } from './wallets/useWallet'
import { useSafeSDK } from './coreSDK/safeCoreSDK'
import useIsSafeOwner from './useIsSafeOwner'
import { Errors, logError } from '@/services/exceptions'
import useSafeInfo from './useSafeInfo'
import { estimateTxBaseGas } from '@safe-global/protocol-kit/dist/src/utils/transactions/gas'
import {
  getCompatibilityFallbackHandlerContract,
  getSimulateTxAccessorContract,
} from '@safe-global/protocol-kit/dist/src/contracts/safeDeploymentContracts'
import { type JsonRpcProvider } from 'ethers'
import { type ExtendedSafeInfo } from '@safe-global/store/slices/SafeInfo/types'
import { postSafeGasEstimation } from '@safe-global/safe-gateway-typescript-sdk'

const getEncodedSafeTx = (
  safeSDK: Safe,
  safeTx: SafeTransaction,
  from: string | undefined,
  needsSignature: boolean,
): string | undefined => {
  const EXEC_TX_METHOD = 'execTransaction'

  // @ts-ignore union type is too complex
  return safeSDK
    .getContractManager()
    .safeContract?.encode(EXEC_TX_METHOD, [
      safeTx.data.to,
      safeTx.data.value,
      safeTx.data.data,
      safeTx.data.operation,
      safeTx.data.safeTxGas,
      safeTx.data.baseGas,
      safeTx.data.gasPrice,
      safeTx.data.gasToken,
      safeTx.data.refundReceiver,
      encodeSignatures(safeTx, from, needsSignature),
    ])
}

const GasMultipliers = {
  [chains.gno]: 1.3,
  [chains.zksync]: 20,
}

// Chain-specific gas adjustments for networks with common gas issues
const getChainSpecificGasAdjustment = (chainId: string, safeTx: SafeTransaction): number => {
  // Base multiplier
  let adjustment = 1.0

  // Specific adjustments for known problematic chains
  switch (chainId) {
    case chains.gno:
      adjustment = 1.3
      break
    case chains.zksync:
      adjustment = 20
      break
    // Add more chains as needed
    default:
      // For other chains, add small buffer for complex transactions
      if (safeTx.data.data && safeTx.data.data.length > 500) {
        adjustment = 1.1 // 10% buffer for complex transactions on other chains
      }
  }

  return adjustment
}

const incrementByGasMultiplier = (value: bigint, multiplier: number) => {
  return (value * BigInt(100 * multiplier)) / BigInt(100)
}

// Retry configuration
const RETRY_ATTEMPTS = 3
const RETRY_DELAY_BASE = 1000 // 1 second
const SAFETY_BUFFER_MULTIPLIER = 1.3 // Increased from 1.2 to 1.3 (30% safety buffer)
const CONSERVATIVE_GAS_LIMIT = 500000n // Conservative fallback gas limit

// Dynamic safety buffer based on transaction complexity
const getDynamicSafetyBuffer = (safeTx: SafeTransaction): number => {
  // Base safety buffer
  let buffer = SAFETY_BUFFER_MULTIPLIER

  // Increase buffer for complex transactions (more data)
  if (safeTx.data.data && safeTx.data.data.length > 1000) {
    buffer += 0.1 // Additional 10% for complex transactions
  }

  // Increase buffer for value transfers
  if (safeTx.data.value && safeTx.data.value !== '0') {
    buffer += 0.05 // Additional 5% for value transfers
  }

  // Increase buffer for contract interactions (non-zero data)
  if (safeTx.data.data && safeTx.data.data !== '0x') {
    buffer += 0.1 // Additional 10% for contract interactions
  }

  return Math.min(buffer, 1.5) // Cap at 50% buffer
}

// Exponential backoff delay
const getRetryDelay = (attempt: number): number => {
  return RETRY_DELAY_BASE * Math.pow(2, attempt)
}

// Sleep utility
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Detect gas-related errors and provide better error messages
const isGasLimitError = (error: any): boolean => {
  const errorMessage = error?.message?.toLowerCase() || ''
  const errorReason = error?.reason?.toLowerCase() || ''

  return (
    errorMessage.includes('gas') ||
    errorMessage.includes('gas limit') ||
    errorMessage.includes('call gas cost exceeds') ||
    errorReason.includes('gas') ||
    errorReason.includes('gas limit') ||
    errorReason.includes('call gas cost exceeds')
  )
}

// Enhanced error handling for gas estimation
const handleGasEstimationError = (error: any, attempt: number): void => {
  if (isGasLimitError(error)) {
    console.warn(`Gas limit error on attempt ${attempt + 1}:`, error.message)
    // Log additional context for debugging
    console.warn('This might indicate insufficient gas buffer or complex transaction')
  } else {
    console.warn(`Gas estimation attempt ${attempt + 1} failed:`, error)
  }
}

// Fallback gas estimation using Safe Gateway API
const estimateGasViaGateway = async (
  chainId: string,
  safeAddress: string,
  safeTx: SafeTransaction,
): Promise<bigint> => {
  try {
    const estimation = await postSafeGasEstimation(chainId, safeAddress, {
      to: safeTx.data.to,
      value: safeTx.data.value,
      data: safeTx.data.data,
      operation: safeTx.data.operation as any,
    })

    // Convert to bigint and add dynamic safety buffer
    const estimatedGas = BigInt(estimation.safeTxGas || '21000')
    const dynamicBuffer = getDynamicSafetyBuffer(safeTx)
    return (estimatedGas * BigInt(Math.floor(dynamicBuffer * 100))) / BigInt(100)
  } catch (error) {
    console.warn('Gateway gas estimation failed:', error)
    throw error
  }
}

// Conservative gas estimation as last resort
const getConservativeGasEstimate = (safeTx: SafeTransaction): bigint => {
  // Base gas for Safe transaction
  const baseGas = 21000n

  // Add gas for data length (4 gas per byte)
  const dataLength = safeTx.data.data ? BigInt(safeTx.data.data.length - 2) / BigInt(2) : 0n
  const dataGas = dataLength * 4n

  // Add gas for value transfer if any
  const valueGas = safeTx.data.value && safeTx.data.value !== '0' ? 9000n : 0n

  // Add safety buffer
  const totalGas = baseGas + dataGas + valueGas + CONSERVATIVE_GAS_LIMIT

  // Use dynamic buffer for conservative estimation
  const dynamicBuffer = getDynamicSafetyBuffer(safeTx)
  return (totalGas * BigInt(Math.floor(dynamicBuffer * 100))) / BigInt(100)
}

/**
 * Estimates the gas limit for a transaction that will be executed on the zkSync network.
 *
 *  The rpc call for estimateGas is failing for the zkSync network, when the from address
 *  is a Safe. Quote from this discussion:
 *  https://github.com/zkSync-Community-Hub/zksync-developers/discussions/144
 *  ======================
 *  zkSync has native account abstraction and, under the hood, all accounts are a smart
 *  contract account. Even EOA use the DefaultAccount smart contract. All smart contract
 *  accounts on zkSync must be deployed using the createAccount or create2Account
 *  methods of the ContractDeployer system contract.
 *
 * When processing a transaction, the protocol checks the code of the from account and,
 * in this case, as Safe accounts are not deployed as native accounts on zkSync
 * (via createAccount or create2Account), it fails with the error above.
 * ======================
 *
 * We do some "magic" here by simulating the transaction on the SafeProxy contract
 *
 * @param safe
 * @param web3
 * @param safeSDK
 * @param safeTx
 */
const getGasLimitForZkSync = async (
  safe: ExtendedSafeInfo,
  web3: JsonRpcProvider,
  safeSDK: Safe,
  safeTx: SafeTransaction,
): Promise<bigint> => {
  // use a random EOA address as the from address
  // https://github.com/zkSync-Community-Hub/zksync-developers/discussions/144
  const fakeEOAFromAddress = '0x330d9F4906EDA1f73f668660d1946bea71f48827'
  const customContracts = safeSDK.getContractManager().contractNetworks?.[safe.chainId]
  const safeVersion = safeSDK.getContractVersion()
  const safeProvider = new SafeProvider({ provider: web3._getConnection().url })
  const fallbackHandlerContract = await getCompatibilityFallbackHandlerContract({
    safeProvider,
    safeVersion,
    customContracts,
  })

  const simulateTxAccessorContract = await getSimulateTxAccessorContract({
    safeProvider,
    safeVersion,
    customContracts,
  })

  // 2. Add a simulate call to the predicted SafeProxy as second transaction
  const transactionDataToEstimate: string = simulateTxAccessorContract.encode('simulate', [
    safeTx.data.to,
    // @ts-ignore
    safeTx.data.value,
    safeTx.data.data as `0x${string}`,
    safeTx.data.operation,
  ])

  const safeFunctionToEstimate: string = fallbackHandlerContract.encode('simulate', [
    simulateTxAccessorContract.getAddress(),
    transactionDataToEstimate as `0x${string}`,
  ])

  const gas = await web3.estimateGas({
    to: safe.address.value,
    from: fakeEOAFromAddress,
    value: '0',
    data: safeFunctionToEstimate,
  })

  // The estimateTxBaseGas function seems to estimate too low for zkSync
  const baseGas = incrementByGasMultiplier(
    BigInt(await estimateTxBaseGas(safeSDK, safeTx)),
    GasMultipliers[chains.zksync],
  )

  return BigInt(gas) + baseGas
}

// Enhanced gas estimation with retry logic and fallbacks
const estimateGasWithRetry = async (
  web3ReadOnly: JsonRpcProvider,
  safeAddress: string,
  walletAddress: string,
  encodedSafeTx: string,
  safe: ExtendedSafeInfo,
  safeSDK: Safe,
  safeTx: SafeTransaction,
  currentChainId: string,
): Promise<bigint> => {
  // Method 1: Try RPC estimation with retries
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const gasLimit = await web3ReadOnly.estimateGas({
        to: safeAddress,
        from: walletAddress,
        data: encodedSafeTx,
      })

      // Apply chain-specific adjustments
      const chainAdjustment = getChainSpecificGasAdjustment(currentChainId, safeTx)
      const adjustedGasLimit = incrementByGasMultiplier(gasLimit, chainAdjustment)

      // Add dynamic safety buffer based on transaction complexity
      const dynamicBuffer = getDynamicSafetyBuffer(safeTx)
      return (adjustedGasLimit * BigInt(Math.floor(dynamicBuffer * 100))) / BigInt(100)
    } catch (error) {
      handleGasEstimationError(error, attempt)

      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(getRetryDelay(attempt))
      }
    }
  }

  // Method 2: Try Safe Gateway API
  try {
    console.log('Falling back to Safe Gateway API for gas estimation')
    return await estimateGasViaGateway(safe.chainId, safeAddress, safeTx)
  } catch (error) {
    console.warn('Safe Gateway gas estimation failed:', error)
  }

  // Method 3: Use conservative estimation
  console.log('Using conservative gas estimation as fallback')
  return getConservativeGasEstimate(safeTx)
}

const useGasLimit = (
  safeTx?: SafeTransaction,
): {
  gasLimit?: bigint
  gasLimitError?: Error
  gasLimitLoading: boolean
} => {
  const safeSDK = useSafeSDK()
  const web3ReadOnly = useWeb3ReadOnly()
  const { safe } = useSafeInfo()
  const safeAddress = safe.address.value
  const threshold = safe.threshold
  const wallet = useSigner()
  const walletAddress = wallet?.address
  const isOwner = useIsSafeOwner()
  const currentChainId = useChainId()

  const [gasLimit, gasLimitError, gasLimitLoading] = useAsync<bigint | undefined>(async () => {
    if (!safeAddress || !walletAddress || !safeSDK || !web3ReadOnly || !safeTx) return

    const encodedSafeTx = getEncodedSafeTx(
      safeSDK,
      safeTx,
      isOwner ? walletAddress : undefined,
      safeTx.signatures.size < threshold,
    )

    // if we are dealing with zksync and the walletAddress is a Safe, we have to do some magic
    // FIXME a new check to indicate ZKsync chain will be added to the config service and available under ChainInfo
    if (
      (safe.chainId === chains.zksync || safe.chainId === chains.lens) &&
      (await web3ReadOnly.getCode(walletAddress)) !== '0x'
    ) {
      return getGasLimitForZkSync(safe, web3ReadOnly, safeSDK, safeTx)
    }

    return estimateGasWithRetry(
      web3ReadOnly,
      safeAddress,
      walletAddress,
      encodedSafeTx!,
      safe,
      safeSDK,
      safeTx,
      currentChainId,
    )
  }, [safeAddress, walletAddress, safeSDK, web3ReadOnly, safeTx, isOwner, currentChainId, threshold, safe])

  useEffect(() => {
    if (gasLimitError) {
      logError(Errors._612, gasLimitError.message)

      // Provide additional context for gas-related errors
      if (isGasLimitError(gasLimitError)) {
        console.warn('Gas estimation failed. Consider:')
        console.warn('1. Increasing gas limit manually')
        console.warn('2. Breaking complex transactions into smaller ones')
        console.warn('3. Checking if the transaction parameters are correct')
      }
    }
  }, [gasLimitError])

  return { gasLimit, gasLimitError, gasLimitLoading }
}

export default useGasLimit
