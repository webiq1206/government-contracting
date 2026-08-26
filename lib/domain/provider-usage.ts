/**
 * Which credential the automation is spending, how much it has spent, and
 * whether the provider is still accepting the calls.
 *
 * The audit asks Automation Health to show provider usage and credit status,
 * and the page showed neither. That gap is not cosmetic. Three separate
 * things can stop every agent on this platform overnight, and none of them
 * announced itself anywhere in the interface until after it had happened:
 * a credit balance running out, a borrowed key whose grant expires, and a
 * trial allowance reaching its cap. All three are visible in advance, and all
 * three read afterwards as "the automation just stopped working".
 *
 * The rule the rest of this redesign runs on applies with particular force
 * here: an unmeasured figure is never nought. An account that has made no AI
 * calls in a day has not spent nought tokens successfully, it has spent
 * nothing at all, and those look identical if the panel prints a zero.
 */

export type CredentialSource =
  | "own_key"
  | "granted"
  | "trial"
  | "environment"
  | "none";

export type CreditState =
  | "out_of_credit"
  | "key_rejected"
  | "throttled"
  | "accepting"
  | "unmeasured";

export interface ExpiryWarning {
  at: string;
  daysLeft: number;
  /** Expired already, inside a week, or further out. */
  urgency: "expired" | "soon" | "later";
}

export interface CredentialView {
  source: CredentialSource;
  label: string;
  /** Who pays, in a sentence. */
  explanation: string;
  expiry: ExpiryWarning | null;
}

const SOURCE_LABEL: Record<CredentialSource, string> = {
  own_key: "Your own Anthropic key",
  granted: "A platform key, lent to this account",
  trial: "A platform key, during the trial",
  environment: "The platform's own key",
  none: "No AI credential",
};

const SOURCE_EXPLANATION: Record<CredentialSource, string> = {
  own_key:
    "Calls are billed to your Anthropic account. Credit and rate limits are set there.",
  granted:
    "Calls are billed to us under an explicit grant. If the grant lapses, every agent that needs the model stops.",
  trial:
    "Calls are billed to us for the length of the trial, up to a call allowance. Supplying your own key removes both limits.",
  // The founding organization resolves straight from the environment. Saying
  // "no credential" here would be wrong in the most confusing possible way:
  // the panel would report nothing configured on the one account where
  // everything is running.
  environment:
    "This is the founding account, so calls resolve from the platform environment and are billed to us.",
  none: "Nothing can be scored, analysed or drafted until a key is supplied.",
};

const DAY_MS = 86_400_000;

export function credentialView(
  source: CredentialSource,
  expiresAt: Date | string | null,
  now = new Date()
): CredentialView {
  let expiry: ExpiryWarning | null = null;
  const at =
    expiresAt == null ? null : expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (at && !Number.isNaN(at.getTime())) {
    // Rounded up, so a grant with nineteen hours left reads "1 day" rather
    // than "0 days", which would look like it had already gone.
    const daysLeft = Math.ceil((at.getTime() - now.getTime()) / DAY_MS);
    expiry = {
      at: at.toISOString(),
      daysLeft,
      urgency: daysLeft <= 0 ? "expired" : daysLeft <= 7 ? "soon" : "later",
    };
  }
  return {
    source,
    label: SOURCE_LABEL[source],
    explanation: SOURCE_EXPLANATION[source],
    expiry,
  };
}

export interface CreditView {
  state: CreditState;
  label: string;
  detail: string;
}

/**
 * What the provider is currently doing with our calls.
 *
 * Derived from the incidents already grouped on this page rather than from a
 * second source, so the credit line and the incident list cannot contradict
 * each other. When nothing has called the provider at all, the honest answer
 * is that nobody knows: a quiet account and a working one look identical from
 * here, and claiming the second is how a stopped machine reads as a healthy
 * one.
 */
export function creditView(causes: string[], callsMade: number): CreditView {
  if (causes.includes("provider_credit")) {
    return {
      state: "out_of_credit",
      label: "Refusing calls: out of credit",
      detail: "The provider rejected calls for want of balance. Nothing is being scored, analysed or drafted.",
    };
  }
  if (causes.includes("provider_auth")) {
    return {
      state: "key_rejected",
      label: "Refusing calls: key rejected",
      detail: "The credential was revoked, deleted, or saved incompletely. Replacing it restores every agent at once.",
    };
  }
  if (causes.includes("provider_rate_limit")) {
    return {
      state: "throttled",
      label: "Throttling calls",
      detail: "The account is at its rate limit. Work retries on its own, so this usually needs nobody, but it slows everything down.",
    };
  }
  if (callsMade <= 0) {
    return {
      state: "unmeasured",
      label: "Nothing measured",
      detail: "No model calls were recorded in this window, so there is nothing to report either way.",
    };
  }
  return {
    state: "accepting",
    label: "Accepting calls",
    detail: `${callsMade} model call${callsMade === 1 ? "" : "s"} recorded, none refused.`,
  };
}

export interface TokenTotals {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Share of input tokens served from cache, or null when nothing went in. */
  cacheHitRate: number | null;
}

/**
 * Adds up recorded token usage, or returns null when there is none.
 *
 * Null rather than a row of zeroes, because "we made no calls" and "we made
 * calls that consumed nothing" are different claims and only one of them can
 * be true.
 */
export function tokenTotals(
  rows: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  }[]
): TokenTotals | null {
  if (rows.length === 0) return null;
  const n = (v: unknown): number => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
  };
  const t = { calls: rows.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const r of rows) {
    t.input += n(r.input_tokens);
    t.output += n(r.output_tokens);
    t.cacheRead += n(r.cache_read_input_tokens);
    t.cacheWrite += n(r.cache_creation_input_tokens);
  }
  const seen = t.input + t.cacheRead;
  return {
    ...t,
    cacheHitRate: seen > 0 ? Math.round((t.cacheRead / seen) * 1000) / 10 : null,
  };
}

export interface AllowanceView {
  used: number;
  limit: number;
  remaining: number;
  pctUsed: number;
  /** Whether the account is close enough to the cap to warn about it. */
  nearLimit: boolean;
  exhausted: boolean;
}

/**
 * A borrowed-key allowance, when there is a cap on one.
 *
 * Returns null when the credential has no cap, rather than inventing one:
 * an account on its own key is limited by its own billing, and drawing a
 * progress bar against a number this system did not set would be fiction.
 */
export function allowanceView(used: number, limit: number | null): AllowanceView | null {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null;
  const u = Math.max(0, used);
  const pctUsed = Math.min(100, Math.round((u / limit) * 1000) / 10);
  return {
    used: u,
    limit,
    remaining: Math.max(0, limit - u),
    pctUsed,
    nearLimit: pctUsed >= 80 && u < limit,
    exhausted: u >= limit,
  };
}

/** Compact token counts. 1_240_000 reads as 1.2M, not as a wall of digits. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
