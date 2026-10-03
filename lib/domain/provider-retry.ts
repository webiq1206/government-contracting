/** Only normalized, persistent account failures stop an immediate queue retry.
 * Legacy string-only failures remain supported; typed retryability takes priority.
 */
export function providerNeedsIntervention(message: string): boolean {
  return /AI_UNAVAILABLE:/.test(message) && /specified (?:API )?usage limits|regain access on|credit balance is too low|insufficient credit|billing quota|insufficient_quota|billing allowance has been exhausted|rejected the API key/i.test(message);
}
