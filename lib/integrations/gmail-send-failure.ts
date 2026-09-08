/**
 * Translate a Gmail sender-identity refusal into an actionable operator message.
 *
 * Kept independent from the Google client so callers that only need to explain
 * an error do not have to initialize the provider SDK or any connection state.
 */
export function describeSendFailure(message: string, from: string): string {
  const fromRefused =
    /invalid from|from header|does not match|not.*allowed to send|delegation denied/i.test(message);
  if (!fromRefused) return message;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  return `Google refused to send as ${address}. Check that it is still listed as a verified address in Gmail under Settings, Accounts, Send mail as, or choose a different sending address in Settings, Integrations. (Google said: ${message})`;
}
