/**
 * What an integration is actually doing, in six states.
 *
 * The cards said `Connected` whenever a key had been saved, and the page's own
 * comment already admitted what that cost: it said `Connected` through a day
 * in which Anthropic refused every request for want of credits, which is the
 * one day it mattered. A saved key and a working service are different facts,
 * and the whole point of this panel is to answer the second one.
 *
 * The six states are the audit's, and they are ordered by what an operator has
 * to do about them. Nothing here guesses: an integration nobody has tested is
 * `configured`, not `healthy`, because "we have not checked" is a true thing to
 * say and "it is working" is not.
 *
 * Pure.
 */

import { classifyFailure, type IncidentCause } from "./automation-health";

export type IntegrationState =
  | "not_configured"
  | "configured"
  | "healthy"
  | "degraded"
  | "blocked"
  | "expired";

export const INTEGRATION_STATE_LABEL: Record<IntegrationState, string> = {
  not_configured: "Not configured",
  configured: "Saved, never tested",
  healthy: "Working",
  degraded: "Degraded",
  blocked: "Blocked",
  expired: "Expired",
};

/** What each state means, in the consequence rather than the category. */
export const INTEGRATION_STATE_MEANING: Record<IntegrationState, string> = {
  not_configured: "Nothing is saved, so everything that depends on this is off.",
  configured:
    "A key is saved and nobody has tested it. Whether it works is unknown until something needs it.",
  healthy: "It answered the last time it was used or tested.",
  degraded: "It is answering some of the time. Expect work to be slow or to retry.",
  blocked: "It is refusing. Nothing that depends on this will run until it is fixed.",
  expired: "The connection has lapsed and needs reauthorising.",
};

/** Colour band. Blocked and expired are both stop conditions. */
export function stateTone(state: IntegrationState): "red" | "amber" | "green" | "slate" {
  if (state === "blocked" || state === "expired") return "red";
  if (state === "degraded") return "amber";
  if (state === "healthy") return "green";
  return "slate";
}

export interface IntegrationFacts {
  /** Every required credential is present. */
  configured: boolean;
  /** The most recent error text from this integration, if any. */
  lastError: string | null;
  /** When a credential here last passed a deliberate test. */
  lastValidatedAt: string | Date | null;
  /**
   * When a real call to the provider last worked.
   *
   * Ranked above a test wherever both exist. A test says the credential
   * parses; a successful real call says the thing works for what it is for,
   * and an integration doing its job hourly should not read as stale because
   * nobody has pressed a button in a month.
   */
  lastSuccessAt?: string | Date | null;
  /**
   * For OAuth integrations: whether the connection itself is still live.
   * Undefined for key-based ones, which have nothing to expire.
   */
  connectionLive?: boolean;
}

/**
 * How stale a passing check has to be before it stops meaning anything.
 *
 * Thirty days is not a measurement, it is a judgement, and it is here as a
 * named constant rather than buried in a comparison so it can be argued with.
 * A key that worked five weeks ago tells you about five weeks ago.
 */
export const VALIDATION_STALE_DAYS = 30;

export interface IntegrationVerdict {
  state: IntegrationState;
  /** Why it is in that state, naming the actual cause where one is known. */
  reason: string;
  /** The cause, for grouping alongside automation incidents. */
  cause: IncidentCause | null;
  /** The one thing to do, or null when there is nothing to do. */
  nextAction: string | null;
}

/**
 * Decide the state.
 *
 * Ordered by what stops work. An OAuth connection that has lapsed outranks an
 * error message, because the error is usually a symptom of the lapse, and a
 * blocked service outranks a stale check, because a stale check is a question
 * and a refusal is an answer.
 */
export function integrationState(f: IntegrationFacts, now = new Date()): IntegrationVerdict {
  if (!f.configured) {
    return {
      state: "not_configured",
      reason: "Nothing is saved for this.",
      cause: "not_configured",
      nextAction: "Add the credentials below.",
    };
  }

  if (f.connectionLive === false) {
    return {
      state: "expired",
      reason: "The connection has lapsed.",
      cause: "integration_auth",
      nextAction: "Reconnect it.",
    };
  }

  if (f.lastError) {
    const cause = classifyFailure(f.lastError);
    if (cause === "provider_credit") {
      return {
        state: "blocked",
        reason: "The provider is refusing for want of credit.",
        cause,
        nextAction: "Add credit with the provider. Nothing here will fix it.",
      };
    }
    if (cause === "provider_auth" || cause === "integration_auth") {
      return {
        state: "blocked",
        reason: "The credentials are being rejected.",
        cause,
        nextAction: "Replace the key, or reconnect the account.",
      };
    }
    if (cause === "provider_rate_limit" || cause === "provider_unavailable" || cause === "network") {
      return {
        state: "degraded",
        reason:
          cause === "provider_rate_limit"
            ? "The provider is rate-limiting us."
            : cause === "network"
              ? "Requests are failing to reach it."
              : "The provider is having trouble.",
        cause,
        nextAction: "Nothing, unless it persists. Work retries on its own.",
      };
    }
    return {
      state: "degraded",
      reason: "Something failed the last time this was used.",
      cause,
      nextAction: "Test it below to see whether it is still failing.",
    };
  }

  const asDate = (v: string | Date | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const tested = asDate(f.lastValidatedAt);
  const used = asDate(f.lastSuccessAt);

  /*
   * The most recent piece of evidence, whichever kind it is, and the freshness
   * is judged on that. An integration doing its job every hour should not read
   * as stale because nobody has pressed a button in a month, and one tested
   * this morning that has refused every real call since is covered by the
   * error branch above.
   */
  const newest = used && tested ? (used > tested ? used : tested) : (used ?? tested);
  const fromRealUse = newest != null && used != null && newest.getTime() === used.getTime();

  if (!newest) {
    return {
      state: "configured",
      reason: "Saved, and never used or tested.",
      cause: null,
      nextAction: "Test it, so this says something rather than nothing.",
    };
  }

  const days = (now.getTime() - newest.getTime()) / 86_400_000;
  if (days > VALIDATION_STALE_DAYS) {
    return {
      state: "configured",
      reason: fromRealUse
        ? `Last did real work ${Math.round(days)} days ago, which is too long to still count.`
        : `Last tested ${Math.round(days)} days ago, which is too long to still count.`,
      cause: null,
      nextAction: "Test it again.",
    };
  }

  return {
    state: "healthy",
    reason: fromRealUse
      ? "It did real work recently."
      : "It answered the last time it was tested.",
    cause: null,
    nextAction: null,
  };
}
