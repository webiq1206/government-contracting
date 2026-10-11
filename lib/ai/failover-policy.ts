import type { AiProvider } from "./routing";

/** Only known refusals of execution can use the other approved provider.
 * Account access, model/content policy, validation, and uncertain execution
 * never become a reason to route around the original failure. */
export function eligibleForFailover(provider: AiProvider, status: number | null, reason: string): boolean {
  if (status === 401 || status === 403 || status == null) return false;
  if (provider === "OpenAI") {
    return (status === 429 || status === 402) && (
      /^OpenAI reported an exhausted credit balance\./.test(reason) ||
      /^OpenAI reached its billing quota or account allowance\./.test(reason) ||
      /^The OpenAI account has insufficient credit \(its billing quota is used up\)\./.test(reason) ||
      /^OpenAI is rate limiting this account,/.test(reason));
  }
  return ((status === 400 || status === 402) && /^The Anthropic credit balance is too low\./.test(reason)) ||
    (status === 429 && /^Anthropic is rate limiting this account,/.test(reason)) ||
    (status === 529 && /^Anthropic temporarily refused this request because the API is overloaded\./.test(reason));
}

const RETRY_PREFIX = " Next automatic attempt after ";
const MANUAL_RETRY = " Provider retry delay requires manual review before another attempt.";
export function withRetryTime(reason: string, seconds: number | null | undefined, now = Date.now()): string {
  if (seconds != null && (!Number.isFinite(seconds) || seconds < 0 || seconds > 604800)) return reason + MANUAL_RETRY;
  const delay = Math.max(60, seconds ?? 60);
  return `${reason}${RETRY_PREFIX}${new Date(now + delay * 1000).toISOString()}.`;
}
export const requiresRetryReview = (reason: string | null) => Boolean(reason?.endsWith(MANUAL_RETRY));
export function retryTime(reason: string | null): number | null {
  const value = reason?.split(RETRY_PREFIX)[1];
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\.$/.test(value)) return null;
  const time = Date.parse(value.slice(0, -1));
  return Number.isFinite(time) ? time : null;
}
