/** Only normalized, persistent account failures stop an immediate queue retry.
 * Scheduled recovery still runs; this does not change a budget or disable a key.
 */
export function providerNeedsIntervention(message: string): boolean {
  return /AI_UNAVAILABLE:/.test(message) && /specified (?:API )?usage limits|regain access on|credit balance is too low|billing allowance has been exhausted|rejected the API key/i.test(message);
}
