"use client";

import { describeSave, type SaveState } from "@/lib/domain/save-state";

/**
 * What happened to the work, in a line beside the form.
 *
 * Announced rather than merely shown. A save that resolves while somebody is
 * reading the next field is exactly the change a screen reader user gets no
 * signal about, and "did that save" is the question this component exists to
 * stop being asked.
 *
 * The state is never carried by colour alone: each one has its own words, and
 * the two that need a person also carry a button.
 */
export function SaveStatus({
  state,
  attempt,
  retryInMs,
  reason,
  onRetry,
  className = "",
}: {
  state: SaveState;
  attempt?: number;
  retryInMs?: number | null;
  reason?: string | null;
  /** Shown as Try again when the automatic attempts are spent. */
  onRetry?: () => void;
  className?: string;
}) {
  const described = describeSave(state, { attempt, retryInMs, reason });
  if (!described.text) return null;

  const tone =
    state === "saved"
      ? "text-pursue"
      : state === "failed"
        ? "text-risk"
        : "text-muted-foreground";

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 text-xs ${tone} ${className}`}>
      {/*
        Polite rather than assertive: this interrupts nothing, and a save
        status that talks over the field somebody is typing into is worse than
        one nobody hears.
      */}
      <span role="status" aria-live="polite">
        {described.text}
      </span>
      {state === "failed" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 underline underline-offset-2 hover:text-foreground lg:min-h-0"
        >
          Try again
        </button>
      )}
    </span>
  );
}

/**
 * The offer to put back a draft this device kept.
 *
 * Offered, never applied. The record may have moved on since the draft was
 * written, by somebody else or by this operator on another device, and
 * replacing what the server holds with what a browser remembers is the version
 * of this feature that destroys work instead of saving it.
 */
export function DraftOffer({
  draft,
  onUse,
  onDiscard,
  preview,
}: {
  draft: string;
  onUse: () => void;
  onDiscard: () => void;
  /**
   * What to show instead of the draft's own first line.
   *
   * A form whose draft is a shape rather than a sentence stores it serialized,
   * and showing somebody a line of JSON to decide on is worse than showing
   * them nothing.
   */
  preview?: string;
}) {
  const excerpt = preview ?? draft.trim().slice(0, 140);
  const truncated = preview == null && draft.trim().length > 140;
  return (
    <div className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs">
      <p className="text-foreground">
        This device kept an edit that was never saved. The record does not have it.
      </p>
      {excerpt && (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
          {excerpt}
          {truncated ? "…" : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={onUse} className="btn-ghost min-h-11 px-3 text-xs lg:min-h-0">
          Put it back
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="min-h-11 text-muted-foreground underline underline-offset-2 hover:text-foreground lg:min-h-0"
        >
          Discard it
        </button>
      </div>
    </div>
  );
}
