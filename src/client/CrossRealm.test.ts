import { createClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoLocalnet } from 'viem/chains'
import { expect, test } from 'vp/test'

import * as Challenge from '../Challenge.js'
import { charge } from '../tempo/client/Charge.js'
import * as Methods from '../tempo/Methods.js'
import * as Mppx from './Mppx.js'

test('a foreign origin cannot relay a valid zero-amount proof challenge', async () => {
  const account = privateKeyToAccount(
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  )
  const targetRealm = 'target.example'
  const secretKey = 'target-server-secret-only-used-to-issue-challenge'
  const currency = '0x3333333333333333333333333333333333333333'
  const recipient = '0x2222222222222222222222222222222222222222'
  const targetChallenge = Challenge.fromMethod(Methods.charge, {
    secretKey,
    expires: new Date(Date.now() + 60_000).toISOString(),
    realm: targetRealm,
    request: {
      amount: '0',
      currency,
      decimals: 6,
      recipient,
      chainId: tempoLocalnet.id,
    },
  })
  const client = createClient({
    account,
    chain: tempoLocalnet,
    transport: http('http://127.0.0.1'),
  })
  const visited: string[] = []
  let capturedCredential: string | null = null
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    visited.push(String(input))
    const authorization = new Headers(init?.headers).get('authorization')
    if (authorization) {
      capturedCredential = authorization
      return new Response('ok')
    }
    return new Response(null, {
      status: 402,
      headers: { 'WWW-Authenticate': Challenge.serialize(targetChallenge) },
    })
  }
  const mppx = Mppx.create({
    fetch: fakeFetch,
    methods: [charge({ account, getClient: () => client })],
    polyfill: false,
  })

  await expect(mppx.fetch('https://attacker.example/resource')).rejects.toThrow(
    'Refusing to sign Tempo proof for realm',
  )
  expect(visited).toEqual(['https://attacker.example/resource'])
  expect(capturedCredential).toBeNull()

  await expect(mppx.prepareRequest('https://attacker.example/resource')).rejects.toThrow(
    'Refusing to sign Tempo proof for realm',
  )
  expect(capturedCredential).toBeNull()

  const response = await mppx.fetch('https://target.example/resource')
  expect(response.status).toBe(200)
  expect(capturedCredential).not.toBeNull()
})
