import { Challenge, Credential } from 'mppx'
import { Mppx, tempo } from 'mppx/server'
import {
  createClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  maxUint256,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { signTransaction } from 'viem/actions'
import { tempoModerato } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { expect, test, vi } from 'vp/test'

import * as Store from '../../Store.js'
import * as Attribution from '../Attribution.js'

test.each([
  'confirmed',
  'sponsored',
  'missing',
  'lookup_error',
  'reverted',
  'wrong_amount',
  'wrong_recipient',
  'wrong_memo',
  'wrong_hash',
  'success',
] as const)('synchronous charge receipt recovery: %s', async (scenario) => {
  const payer = privateKeyToAccount(`0x${'01'.repeat(32)}`)
  const sponsor = privateKeyToAccount(`0x${'02'.repeat(32)}`)
  const recipient = '0x2222222222222222222222222222222222222222'
  const currency = '0x20c0000000000000000000000000000000000001'
  const otherHash = `0x${'12'.repeat(32)}` as const
  const rpcMethods: string[] = []
  const receiptHashes: string[] = []
  const onPaymentSuccess = vi.fn()
  const store = Store.memory()
  let hash: `0x${string}`
  let memo: `0x${string}`
  const rpcError = { code: -32000, message: 'Synchronous broadcast response unavailable' }
  const client = createClient({
    account: payer,
    chain: tempoModerato,
    transport: custom(
      {
        async request({ method, params }) {
          rpcMethods.push(method)
          if (method === 'eth_chainId') return `0x${tempoModerato.id.toString(16)}`
          if (method === 'eth_call') return '0x'
          if (method === 'eth_sendRawTransactionSync') {
            hash = keccak256(params[0])
            if (scenario !== 'success') throw rpcError
          } else if (method === 'eth_getTransactionReceipt') {
            receiptHashes.push(params[0])
            if (scenario === 'missing') return null
            if (scenario === 'lookup_error')
              throw { code: -32000, message: 'Receipt lookup unavailable' }
          } else throw new Error(`Unexpected RPC method: ${method}`)
          const receiptHash = scenario === 'wrong_hash' ? otherHash : hash
          return {
            blockHash: otherHash,
            blockNumber: '0x1',
            transactionHash: receiptHash,
            transactionIndex: '0x0',
            from: payer.address,
            to: currency,
            status: scenario === 'reverted' ? '0x0' : '0x1',
            type: '0x76',
            gasUsed: '0x1',
            cumulativeGasUsed: '0x1',
            effectiveGasPrice: '0x1',
            contractAddress: null,
            logsBloom: `0x${'00'.repeat(256)}`,
            logs: [
              {
                address: currency,
                blockHash: otherHash,
                blockNumber: '0x1',
                transactionHash: receiptHash,
                transactionIndex: '0x0',
                logIndex: '0x0',
                removed: false,
                topics: encodeEventTopics({
                  abi: Abis.tip20,
                  eventName: 'TransferWithMemo',
                  args: {
                    from: payer.address,
                    to: scenario === 'wrong_recipient' ? payer.address : recipient,
                    memo: scenario === 'wrong_memo' ? otherHash : memo,
                  },
                }),
                data: encodeAbiParameters(
                  [{ type: 'uint256' }],
                  [scenario === 'wrong_amount' ? 1n : 1_000_000n],
                ),
              },
            ],
          }
        },
      },
      { retryCount: 0 },
    ),
  })
  const server = Mppx.create({
    realm: 'api.example.com',
    secretKey: 'test-secret-key-test-secret-key-32',
    methods: [
      tempo.charge({
        account: recipient,
        currency,
        ...(scenario === 'sponsored'
          ? { feePayer: sponsor, feeToken: currency, allowedFeeTokens: [currency] }
          : {}),
        getClient: () => client,
        onPaymentSuccess,
        store,
        testnet: true,
      }),
    ],
  })
  const result = await server.charge({ amount: '1', decimals: 6 })(
    new Request('https://example.com'),
  )
  if (result.status !== 402) throw new Error('Expected challenge')
  const challenge = Challenge.fromResponse(result.challenge)
  memo = Attribution.encode({ challengeId: challenge.id, serverId: challenge.realm })
  const signature = await signTransaction(client, {
    account: payer,
    calls: [
      {
        to: currency,
        data: encodeFunctionData({
          abi: Abis.tip20,
          functionName: 'transferWithMemo',
          args: [recipient, 1_000_000n, memo],
        }),
      },
    ],
    gas: 100_000n,
    ...(scenario === 'sponsored'
      ? { feePayer: true, feeToken: currency, nonceKey: maxUint256 }
      : {}),
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    nonce: 0,
    validBefore: Math.floor(Date.now() / 1_000) + 25,
  })
  const credential = Credential.serialize(
    Credential.from({ challenge, payload: { signature, type: 'transaction' } }),
  )
  if (scenario === 'confirmed' || scenario === 'sponsored' || scenario === 'success') {
    const receipt = await server.broadcastCredential(credential)
    expect(receipt.status).toBe('success')
    expect(receipt.reference).toBe(hash!)
    expect(onPaymentSuccess).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ receipt: expect.objectContaining({ reference: hash! }) }),
    )
  } else if (scenario === 'missing' || scenario === 'lookup_error') {
    await expect(server.broadcastCredential(credential)).rejects.toMatchObject({
      name: 'InvalidInputRpcError',
      code: -32000,
      details: rpcError.message,
    })
    expect(onPaymentSuccess).not.toHaveBeenCalled()
  } else {
    await expect(server.broadcastCredential(credential)).rejects.toThrow()
    expect(onPaymentSuccess).not.toHaveBeenCalled()
  }
  expect(receiptHashes).toEqual(scenario === 'success' ? [] : [hash!])
  if (scenario === 'sponsored') expect(hash!).not.toBe(keccak256(signature))
  expect(await store.get(`mppx:charge:${hash!}`)).not.toBeNull()
  await expect(server.broadcastCredential(credential)).rejects.toThrow(
    'Transaction hash has already been used',
  )
  expect(rpcMethods.filter((method) => method === 'eth_sendRawTransactionSync')).toHaveLength(1)
})
