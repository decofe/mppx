# Deferred EVM payments

## Choose the signer after preparation

`evm.charge()` accepts an optional account. `preparePayment` selects and snapshots an offer
without signing it. Supply the account to `createCredential` when ready to pay:

```ts
import { Mppx, evm } from 'mppx/client'
import type { Account } from 'viem'

async function prepare(response: Response, account: Account) {
  const client = Mppx.create({
    methods: [evm.charge({ currencies: [evm.assets.base.USDC], networks: [8453] })],
    polyfill: false,
  })
  const payment = await client.preparePayment(response)
  // Inspect payment.challenge and enforce the application's quote/budget policy here.
  return payment.createCredential({ account })
}
```

This works for native EVM Payment-auth and x402 exact offers. A credential-context account
takes precedence over the configured account. If neither is a typed-data signer, credential
creation rejects with a descriptive error; preparation remains available.

## Validate before settlement

An EVM server supports the same `validateCredential` and `broadcastCredential` lifecycle as
Tempo. For a native Payment credential, use the server that issued the challenge:

```ts
const options = { realm: 'api.example.com', request: { amount: '0.25' }, scope: 'job:123' }
const validation = await server.validateCredential(credential, options)
// Atomically claim the application operation using validation.source and the job identity.
const receipt = await server.broadcastCredential(credential, options)
// Persist the completed operation and receipt.reference.
```

Validation checks payment terms, expiry, signature, and payer identity. With the default
facilitator-backed settler it also calls the facilitator's verification endpoint, without
calling settlement. A custom `settle` implementation remains responsible for chain-state
checks and replay protection. Validation is not a reservation or a settlement receipt.

Broadcast revalidates, then settles. Existing route handlers and `verifyCredential` still
perform the complete validate-and-settle flow. The application owns durable claims,
idempotency, and reconciliation if settlement succeeds but persisting its result fails.

For x402, first normalize the transport-native payload with the configured EVM method's
transport. The route challenge must be generated from the server's authoritative route
configuration, including its scope, metadata, and expiration:

```ts
const transport = method.transport!
const pending = transport.getCredential(paidRequest)
if (!pending) throw new Error('Missing payment credential')
const credential = await transport.bindCredential!({
  challenge: routeChallenge,
  credential: pending,
  input: paidRequest,
})
const capturedRequest = await transport.captureRequest!(paidRequest)
const options = { capturedRequest, request: { amount: '0.25' }, scope: 'job:123' }
const validation = await server.validateCredential(credential, options)
// Claim the operation before calling server.broadcastCredential(credential, options).
```

Use the bound credential object directly so its x402 provenance is retained. Do not treat
an unbound `PAYMENT-SIGNATURE` value as a native Payment credential or bypass transport
resource/body binding. Existing x402 route handlers still perform normalization automatically.
