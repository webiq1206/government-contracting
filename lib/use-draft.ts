"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  afterFailure,
  draftDecision,
  draftKey,
  MAX_ATTEMPTS,
  type SaveState,
} from "@/lib/domain/save-state";

/**
 * Keeps what somebody typed, and says honestly what has happened to it.
 *
 * Two jobs, and they are separate on purpose.
 *
 * The first is that the text exists somewhere other than React state. Every
 * form in this product held its draft in a `useState` and nowhere else, so a
 * failed save plus one click on the sidebar was the work gone, and the
 * unsaved-work prompt that guards those clicks only ever bought a second
 * chance at the same click.
 *
 * The second is the retry. A save that fails on a flaky connection succeeds on
 * the next attempt most of the time, and doing that automatically is worth
 * more than any wording; doing it silently is worth less than nothing, which
 * is why every attempt is visible and why there are only three of them.
 */
export function useDraft({
  scope,
  id,
  value,
  serverValue,
  onRestore,
  save,
}: {
  /** Which kind of record this is, e.g. "opportunity-notes". */
  scope: string;
  /** The record's id. Two records never share a draft. */
  id: string;
  /** What is in the form right now. */
  value: string;
  /** What the server last confirmed. */
  serverValue: string;
  /** Called with a draft found on this device, if the operator takes it. */
  onRestore: (draft: string) => void;
  /** Sends the value. Throws, or returns a message, when it does not go. */
  save: (value: string) => Promise<void>;
}) {
  const key = draftKey(scope, id);
  const [state, setState] = useState<SaveState>("clean");
  const [attempt, setAttempt] = useState(0);
  const [retryInMs, setRetryInMs] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  /** A draft found on this device that the operator has not answered yet. */
  const [offered, setOffered] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * The value the in-flight save is carrying. Read at attempt time rather than
   * captured, so a retry sends what is in the form now: somebody who kept
   * typing through a failed save meant the newer text, and sending the older
   * one would quietly undo the edits they made while waiting.
   */
  const latest = useRef(value);
  latest.current = value;
  const saving = useRef(false);
  /*
   * Held in a ref so the retry machinery below has a stable identity. Callers
   * pass an inline function that closes over the form's current state, and
   * hanging the scheduled retry off a new identity every render would mean the
   * timer, the online listener and the in-flight attempt each belonging to a
   * different render's copy of it.
   */
  const send = useRef(save);
  send.current = save;

  // What is on the device, offered rather than applied. See draftDecision.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      return; // Storage off. The form still works; it just forgets.
    }
    const decision = draftDecision(stored, serverValue);
    if (decision.action === "offer") setOffered(decision.draft);
    // Deliberately once per record: a later render must not re-offer a draft
    // the operator has already dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Every keystroke lands on the device. This is the part that makes "your
  // work is kept" true rather than reassuring.
  useEffect(() => {
    try {
      if (value === serverValue) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* storage off */
    }
    setState((prev) => {
      if (value === serverValue) return prev === "saved" ? "saved" : "clean";
      // A save in flight or scheduled keeps saying so; typing during a retry
      // does not cancel it.
      if (prev === "saving" || prev === "retrying" || prev === "offline") return prev;
      return "unsaved";
    });
  }, [value, serverValue, key]);

  const attemptSave = useCallback(
    async (n: number) => {
      if (saving.current) return;
      saving.current = true;
      setState("saving");
      setAttempt(n);
      setRetryInMs(null);
      try {
        await send.current(latest.current);
        setState("saved");
        setAttempt(0);
        setReason(null);
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* storage off */
        }
      } catch (e) {
        const message = (e as Error).message || null;
        const online = typeof navigator === "undefined" ? true : navigator.onLine;
        const outcome = afterFailure({ attempt: n, online });
        setState(outcome.state);
        setRetryInMs(outcome.retryInMs);
        setReason(outcome.state === "failed" ? message : null);
        if (outcome.retryInMs != null) {
          timer.current = setTimeout(() => void attemptSave(n + 1), outcome.retryInMs);
        }
      } finally {
        saving.current = false;
      }
    },
    [key]
  );

  // The connection coming back is the retry, for a save that never left.
  useEffect(() => {
    function online() {
      setState((prev) => {
        if (prev !== "offline") return prev;
        // Restart the count: the attempts spent against a dead network say
        // nothing about a live one.
        void attemptSave(1);
        return "saving";
      });
    }
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [attemptSave]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void attemptSave(1);
  }, [attemptSave]);

  return {
    state,
    attempt,
    retryInMs,
    reason,
    maxAttempts: MAX_ATTEMPTS,
    saveNow,
    /** A draft this device kept that the record does not have. */
    offered,
    useOffered: () => {
      if (offered != null) onRestore(offered);
      setOffered(null);
    },
    discardOffered: () => {
      setOffered(null);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* storage off */
      }
    },
  };
}
