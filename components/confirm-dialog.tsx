"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * The confirmation this product uses instead of `window.confirm`.
 *
 * The native dialog is tempting and wrong for three separate reasons.
 *
 * It cannot say what the action costs. `window.confirm` takes one string, so a
 * question that needs a count, a list of what is kept, or a warning about what
 * cannot be recalled gets flattened into a sentence, and the operator agrees
 * to a word rather than to an outcome.
 *
 * It cannot be styled, positioned or made to belong to the record it is about.
 * On a phone it appears at the top of the viewport attached to the origin,
 * which is the browser's identity rather than the product's.
 *
 * And it blocks the main thread, so nothing behind it can update, load or
 * announce anything while it is open.
 *
 * This one traps focus, restores it to the control that opened it, closes on
 * Escape, is labelled for a screen reader, and never says "Are you sure":
 * every caller passes a question that names the thing and a button that names
 * the act.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Names the thing being acted on, not "Are you sure". */
  title: string;
  /** What happens, and what does not. Anything React can render. */
  body?: React.ReactNode;
  /** Names the act: "Delete this KPI", never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /**
   * Held back because the form is not complete, which is a different state
   * from working. Kept separate so the button does not read "Working" while it
   * is actually waiting for the operator to type something.
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  /*
   * Focus goes in and comes back out.
   *
   * The half people forget is the coming back. A dialog that takes focus and
   * then drops it on the body leaves a keyboard user at the top of the
   * document, several tab stops from where they were, with no indication that
   * anything happened.
   */
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
    return () => {
      opener.current?.focus?.();
    };
  }, [open]);

  const trap = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])"
        ) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      // A click on the backdrop cancels, which is what people expect and what
      // Escape does. It never confirms.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        onKeyDown={trap}
        className="w-full max-w-lg rounded-t-lg border border-border bg-surface p-5 shadow-lg sm:rounded-lg"
        // Above the home indicator on a phone, where this sheet sits.
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <h2 id={titleId} className="font-display text-xl font-normal text-foreground">
          {title}
        </h2>
        {body && (
          <div id={bodyId} className="mt-2 text-sm text-muted-foreground">
            {body}
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? "Working" : confirmLabel}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The same dialog, when the answer is a sentence rather than a yes.
 *
 * `window.prompt` has every problem `window.confirm` has and one more: it
 * cannot validate. The one call site this replaces asked for a reason, got a
 * string back, and then had to check the length afterwards and report the
 * failure through a toast, because a native prompt has nowhere to put an
 * error. So somebody typing "no" saw the dialog vanish, then a toast telling
 * them to try again, and had to reopen it and retype.
 */
export function ReasonDialog({
  open,
  title,
  body,
  placeholder,
  confirmLabel,
  minLength = 3,
  tooShort = "Say a little more. One line is enough.",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  placeholder?: string;
  confirmLabel: string;
  minLength?: number;
  tooShort?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const short = reason.trim().length < minLength;

  useEffect(() => {
    if (!open) {
      setReason("");
      setTouched(false);
    }
  }, [open]);

  return (
    <ConfirmDialog
      open={open}
      title={title}
      body={
        <>
          {body}
          <label className="mt-3 block">
            <span className="label">Reason</span>
            <textarea
              className="input w-full"
              rows={3}
              value={reason}
              placeholder={placeholder}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && short}
            />
            {/* Shown in place rather than after the dialog closes, which is
                what a native prompt forces. */}
            {touched && short && <span className="mt-1 block text-xs text-risk">{tooShort}</span>}
          </label>
        </>
      }
      confirmLabel={confirmLabel}
      danger={danger}
      busy={busy}
      confirmDisabled={short}
      onConfirm={() => onConfirm(reason.trim())}
      onCancel={onCancel}
    />
  );
}
