import type * as Challenge from '../../Challenge.js'

/** Refuse an automatic HTTP proof for a realm other than the server being contacted. */
export function assert(challenge: Challenge.Challenge, url: URL): void {
  if (challenge.method !== 'tempo' || challenge.intent !== 'charge') return
  const amount = challenge.request.amount
  if (typeof amount !== 'string') return
  try {
    if (BigInt(amount) !== 0n) return
  } catch {
    return
  }

  if (challenge.realm.toLowerCase() !== url.hostname.toLowerCase())
    throw new Error(
      `Refusing to sign Tempo proof for realm ${JSON.stringify(challenge.realm)} from ${url.origin}`,
    )
}
