/**
 * What happened to the work somebody typed.
 *
 * Every form in this product had the same two-variable version of this: a
 * `saving` boolean and an `error` string. That shape can say "working" and it
 * can say "something went wrong", and it cannot say the three things that
 * actually matter to somebody who has just lost a connection halfway through
 * writing up a call.
 *
 * It cannot tell a failure from an absence. "Save failed" sent to a laptop
 * with the wifi off is a message that sends somebody to support instead of to
 * the wifi.
 *
 * It cannot say a retry is coming, so a form that is about to try again looks
 * exactly like a form that has given up, and the operator either sits waiting
 * for a save that already succeeded or retypes something that is already on
 * its way.
 *
 * And it never says where the work is. In every one of these forms the text
 * lived in React state and nowhere else, so a failed save plus one click on
 * the sidebar was the work gone. The states below exist so the interface can
 * say the true thing, and the draft is written to the device on every
 * keystroke so that the true thing is "it is still here".
 */
export const SAVE_STATES = [
  /** Nothing typed since the last save. */
  "clean",
  /** Edited, not sent yet. */
  "unsaved",
  "saving",
  "saved",
  /** The device has no connection. Not a failure: a wait. */
  "offline",
  /** A save failed and another attempt is scheduled. */
  "retrying",
  /** Out of automatic attempts. The operator decides what happens next. */
  "failed",
] as const;

export type SaveState = (typeof SAVE_STATES)[number];

/**
 * How long to wait before each retry.
 *
 * Three of them, then stop. An interface that retries forever is one that
 * never tells anybody their work is not saved, and the failure that needs a
 * person (a rejected field, an expired session, a record somebody else
 * deleted) is not one that a fourth attempt fixes.
 */
export const RETRY_DELAYS_MS = [2_000, 6_000, 15_000] as const;

/** First attempt plus the retries above. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export interface FailureOutcome {
  state: Extract<SaveState, "offline" | "retrying" | "failed">;
  /** Milliseconds until the next attempt, or null when there is not one. */
  retryInMs: number | null;
}

/**
 * What a failed save becomes.
 *
 * Offline outranks everything. A save that could not leave the device did not
 * fail on its merits, and the recovery is a connection rather than a decision,
 * so it waits for the `online` event instead of burning the three attempts on
 * a network that is not there.
 */
export function afterFailure(input: { attempt: number; online: boolean }): FailureOutcome {
  if (!input.online) return { state: "offline", retryInMs: null };
  const delay = RETRY_DELAYS_MS[input.attempt - 1];
  if (input.attempt >= MAX_ATTEMPTS || delay === undefined) {
    return { state: "failed", retryInMs: null };
  }
  return { state: "retrying", retryInMs: delay };
}

export interface SaveDescription {
  /** The sentence shown beside the form. Empty when there is nothing to say. */
  text: string;
  /** True when the operator has to do something for this to resolve. */
  needsOperator: boolean;
  /** True while work exists that the server has not accepted. */
  atRisk: boolean;
}

/**
 * The state in words.
 *
 * Every one of these that involves unsaved work says where the work is,
 * because "Not saved" on its own reads as "gone" and the whole point of
 * keeping the draft is that it is not.
 */
export function describeSave(
  state: SaveState,
  ctx: { attempt?: number; retryInMs?: number | null; reason?: string | null } = {}
): SaveDescription {
  switch (state) {
    case "clean":
      return { text: "", needsOperator: false, atRisk: false };
    case "unsaved":
      return { text: "Not saved yet", needsOperator: true, atRisk: true };
    case "saving":
      return { text: "Saving", needsOperator: false, atRisk: true };
    case "saved":
      return { text: "Saved", needsOperator: false, atRisk: false };
    case "offline":
      return {
        text: "No connection. This is kept on this device and goes up when the connection returns.",
        needsOperator: false,
        atRisk: true,
      };
    case "retrying": {
      const seconds = Math.max(1, Math.round((ctx.retryInMs ?? 0) / 1000));
      const attempt = ctx.attempt ?? 1;
      return {
        text: `Save did not go through. Trying again in ${seconds} ${
          seconds === 1 ? "second" : "seconds"
        } (attempt ${attempt + 1} of ${MAX_ATTEMPTS}).`,
        needsOperator: false,
        atRisk: true,
      };
    }
    case "failed":
      return {
        text: ctx.reason
          ? `Not saved: ${ctx.reason} Your work is kept on this device.`
          : "Not saved after several attempts. Your work is kept on this device.",
        needsOperator: true,
        atRisk: true,
      };
  }
}

/**
 * Where a draft is kept on this device.
 *
 * Scoped by record, so two opportunities open in two tabs do not overwrite
 * each other's notes, and prefixed so that clearing this product's drafts is
 * something that can be done without touching anything else in the origin.
 */
export function draftKey(scope: string, id: string): string {
  return `brostco.draft.${scope}.${id}`;
}

export type DraftDecision =
  /** Nothing kept, or what is kept matches the record. */
  | { action: "none" }
  /** Kept work that the record does not have. Offer it, do not apply it. */
  | { action: "offer"; draft: string };

/**
 * What to do with a draft found on the device.
 *
 * It is offered, never applied. The record may have moved on since the draft
 * was written, by somebody else or by this operator on another device, and
 * silently replacing what the server holds with what a browser remembers is
 * the version of this feature that destroys work instead of saving it.
 */
export function draftDecision(stored: string | null, server: string): DraftDecision {
  if (stored == null) return { action: "none" };
  if (stored === server) return { action: "none" };
  if (stored.trim() === "" && server.trim() === "") return { action: "none" };
  return { action: "offer", draft: stored };
}
