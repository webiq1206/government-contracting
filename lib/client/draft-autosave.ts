/**
 * Keeping an operator's edits to a suggested reply.
 *
 * This is deliberately not React. The rules below are the difference between a
 * saved draft the operator can trust and one that occasionally eats a
 * sentence, and they are worth being able to test directly rather than through
 * a rendered component:
 *
 *  - Writes for one draft go out one at a time. Fire-and-forget requests can
 *    land out of order, and the loser of that race overwrites newer text with
 *    older text.
 *  - Typing is debounced, but leaving the page cuts the debounce short instead
 *    of discarding it. Someone who types a line and immediately clicks away is
 *    exactly who this feature is for.
 *  - When the draft is replaced or sent, anything still queued against the old
 *    text is dropped, so it cannot come back on top of the new text.
 */

export interface AutosaveSend {
  (input: {
    communicationId: string;
    body: string;
    /**
     * Which revision this write produces. The server refuses to apply one
     * older than what it already has, which is what actually guarantees a
     * slow write cannot clobber a fast one. The queue below is a courtesy;
     * this is the guarantee, because the last edit before the page closes has
     * to leave outside any queue.
     */
    rev: number;
    /** True when the page is going away and the request must outlive it. */
    keepalive: boolean;
  }): Promise<void>;
}

export interface DraftAutosave {
  /**
   * Start counting revisions for a draft from what the server already has.
   * Without this a reload would restart at 1 and every edit would look older
   * than the stored text, so nothing would ever save again.
   */
  seed(communicationId: string, rev: number): void;
  /** Record a keystroke. Writes after the debounce, or sooner on a flush. */
  edit(communicationId: string, body: string): void;
  /** Forget anything queued for this draft: it has been replaced or sent. */
  invalidate(communicationId: string): void;
  /**
   * Write out everything still pending. `immediate` skips the ordering queue
   * for the case where the browser is tearing the page down and there is no
   * time to wait behind an in-flight request.
   */
  flush(immediate: boolean): void;
  /** Test hook: resolves once every queued write has finished. */
  settled(): Promise<void>;
}

export function createDraftAutosave(opts: {
  send: AutosaveSend;
  /** Quiet period after the last keystroke. */
  delayMs?: number;
}): DraftAutosave {
  const delay = opts.delayMs ?? 900;
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const chains: Record<string, Promise<void>> = {};
  const epochs: Record<string, number> = {};
  const revs: Record<string, number> = {};
  /** Text typed but not yet written, with the revision it was assigned. */
  const pending: Record<string, { body: string; rev: number }> = {};

  function write(id: string, body: string, rev: number, keepalive: boolean) {
    // A failed autosave is not worth interrupting anyone over: the text is
    // still in the box in front of them.
    return opts
      .send({ communicationId: id, body, rev, keepalive })
      .catch(() => {});
  }

  function enqueue(id: string, body: string, rev: number, epoch: number) {
    const prior = chains[id] ?? Promise.resolve();
    chains[id] = prior.then(async () => {
      if ((epochs[id] ?? 0) !== epoch) return;
      await write(id, body, rev, false);
    });
  }

  return {
    seed(id, rev) {
      revs[id] = Math.max(revs[id] ?? 0, rev);
    },

    edit(id, body) {
      clearTimeout(timers[id]);
      // The revision is assigned when the text is typed, not when it is sent,
      // so it reflects the order the operator made the changes rather than the
      // order the network happened to deliver them.
      const rev = (revs[id] ?? 0) + 1;
      revs[id] = rev;
      // Recorded before the timer so that leaving mid-debounce still has
      // something to send.
      pending[id] = { body, rev };
      const epoch = epochs[id] ?? 0;
      timers[id] = setTimeout(() => {
        // A flush may already have taken this text.
        if (pending[id]?.rev !== rev) return;
        delete pending[id];
        enqueue(id, body, rev, epoch);
      }, delay);
    },

    invalidate(id) {
      clearTimeout(timers[id]);
      delete pending[id];
      epochs[id] = (epochs[id] ?? 0) + 1;
      // The revision counter is deliberately not reset. It only ever goes up,
      // here and on the server, which is what makes a write that was already
      // on the wire when this happened lose rather than win.
    },

    flush(immediate) {
      for (const [id, entry] of Object.entries(pending)) {
        clearTimeout(timers[id]);
        delete pending[id];
        if (immediate) {
          // No time to queue behind an in-flight write, and no need: this
          // carries a higher revision, so the server will not let the older
          // one replace it whichever order they arrive in.
          void write(id, entry.body, entry.rev, true);
        } else {
          enqueue(id, entry.body, entry.rev, epochs[id] ?? 0);
        }
      }
    },

    async settled() {
      await Promise.all(Object.values(chains));
    },
  };
}
