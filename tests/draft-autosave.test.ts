import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDraftAutosave } from "@/lib/client/draft-autosave";

/**
 * Whether an operator's edits to a suggested reply actually survive.
 *
 * The generated draft costs money, so the whole promise of keeping it is that
 * someone who gets pulled away mid-sentence finds their work where they left
 * it. Every test here is a way that promise can quietly break.
 */

interface Sent {
  communicationId: string;
  body: string;
  rev: number;
  keepalive: boolean;
}

function harness(opts: { hang?: boolean } = {}) {
  const sent: Sent[] = [];
  let release: (() => void) | null = null;
  const send = vi.fn(async (s: Sent) => {
    sent.push(s);
    if (opts.hang && sent.length === 1) {
      await new Promise<void>((r) => {
        release = r;
      });
    }
  });
  const autosave = createDraftAutosave({ send, delayMs: 900 });
  return { autosave, sent, send, releaseFirst: () => release?.() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("keeping an edit", () => {
  it("writes once the typing stops, not on every keystroke", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "Dana,");
    vi.advanceTimersByTime(300);
    autosave.edit("m1", "Dana, it's");
    vi.advanceTimersByTime(300);
    autosave.edit("m1", "Dana, it's 42,000 sf.");
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(900);
    await autosave.settled();
    expect(sent.map((s) => s.body)).toEqual(["Dana, it's 42,000 sf."]);
  });

  it("saves a sentence typed a moment before leaving the page", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "Dana, it's 42,000 sf.");
    // Nowhere near the debounce: this is the operator typing and immediately
    // clicking through to the next subcontractor.
    vi.advanceTimersByTime(50);
    autosave.flush(false);
    await autosave.settled();

    expect(sent.map((s) => s.body)).toEqual(["Dana, it's 42,000 sf."]);
  });

  it("outlives the tab being closed", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "Almost done here.");
    autosave.flush(true);
    await autosave.settled();

    expect(sent).toHaveLength(1);
    // Without keepalive the browser cancels the request on its way out and
    // the edit is gone.
    expect(sent[0].keepalive).toBe(true);
  });

  it("does not write twice when the debounce fires after a flush", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "One copy only.");
    autosave.flush(false);
    vi.advanceTimersByTime(2000);
    await autosave.settled();

    expect(sent).toHaveLength(1);
  });

  it("has nothing to flush when nothing was typed", async () => {
    const { autosave, sent } = harness();
    autosave.flush(false);
    autosave.flush(true);
    await autosave.settled();
    expect(sent).toHaveLength(0);
  });
});

describe("not losing an edit to a race", () => {
  it("never lets an older write land after a newer one", async () => {
    // The first request hangs. Without a queue the second would overtake it
    // and the stale text would be written last.
    const { autosave, sent, releaseFirst } = harness({ hang: true });
    autosave.edit("m1", "first");
    vi.advanceTimersByTime(900);
    await Promise.resolve();

    autosave.edit("m1", "second");
    vi.advanceTimersByTime(900);
    await Promise.resolve();
    expect(sent.map((s) => s.body)).toEqual(["first"]);

    releaseFirst();
    await autosave.settled();
    expect(sent.map((s) => s.body)).toEqual(["first", "second"]);
  });

  it("stamps a closing-tab write as newer than the one still in flight", async () => {
    // The sequence that no client-side queue can fix: an earlier save is
    // already on the wire when the operator types one more line and closes the
    // tab. The last write has to leave immediately, so it may well arrive
    // first, and the stalled one lands afterwards carrying older text. The
    // revision is what stops that from being data loss.
    const { autosave, sent, releaseFirst } = harness({ hang: true });
    autosave.edit("m1", "half a sentence");
    vi.advanceTimersByTime(900);
    await Promise.resolve();
    expect(sent).toHaveLength(1);

    autosave.edit("m1", "half a sentence, finished");
    vi.advanceTimersByTime(50);
    autosave.flush(true);
    await Promise.resolve();

    const closing = sent[1];
    expect(closing.body).toBe("half a sentence, finished");
    expect(closing.keepalive).toBe(true);
    // Higher revision, so the server refuses to let the older write replace
    // it however the two requests happen to land.
    expect(closing.rev).toBeGreaterThan(sent[0].rev);

    releaseFirst();
    await autosave.settled();
  });

  it("counts up from what the server already stored", async () => {
    // A reload starts a fresh counter. Without seeding it would begin at 1,
    // below the stored revision, and every edit would be discarded as stale
    // with nothing looking broken.
    const { autosave, sent } = harness();
    autosave.seed("m1", 7);
    autosave.edit("m1", "carrying on where I left off");
    vi.advanceTimersByTime(900);
    await autosave.settled();

    expect(sent[0].rev).toBe(8);
  });

  it("gives every edit a higher revision than the last", async () => {
    const { autosave, sent } = harness();
    for (const body of ["one", "two", "three"]) {
      autosave.edit("m1", body);
      vi.advanceTimersByTime(900);
    }
    await autosave.settled();

    const revs = sent.map((s) => s.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
  });

  it("keeps counting past a rewrite instead of starting over", async () => {
    // The counter only ever goes up. If a rewrite sent it back to zero, an
    // edit that was already on the wire when the rewrite landed would look
    // newer than the replacement and quietly restore the text the operator
    // just threw away.
    const { autosave, sent, releaseFirst } = harness({ hang: true });
    autosave.edit("m1", "an edit to the old draft");
    vi.advanceTimersByTime(900);
    await Promise.resolve();
    const inFlight = sent[0].rev;

    // "Rewrite draft" returns, carrying the revision the server bumped to.
    autosave.invalidate("m1");
    autosave.seed("m1", inFlight + 1);
    autosave.edit("m1", "a tweak to the new draft");
    vi.advanceTimersByTime(900);
    releaseFirst();
    await autosave.settled();

    const after = sent[sent.length - 1];
    expect(after.body).toBe("a tweak to the new draft");
    expect(after.rev).toBeGreaterThan(inFlight);
  });

  it("keeps one thread's timer from cancelling another's", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "to Dana");
    autosave.edit("m2", "to Ray");
    vi.advanceTimersByTime(900);
    await autosave.settled();

    expect(sent.map((s) => `${s.communicationId}:${s.body}`).sort()).toEqual([
      "m1:to Dana",
      "m2:to Ray",
    ]);
  });
});

describe("dropping an edit that no longer applies", () => {
  it("does not resurrect edits to a draft that was rewritten", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "the old wording");
    // "Rewrite draft" replaced the text under them.
    autosave.invalidate("m1");
    vi.advanceTimersByTime(2000);
    autosave.flush(false);
    await autosave.settled();

    expect(sent).toHaveLength(0);
  });

  it("does not write sent text back after the reply has gone out", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "Thanks Dana.");
    vi.advanceTimersByTime(900);
    // Send happens while that write is queued; the server discards the draft.
    autosave.invalidate("m1");
    await autosave.settled();

    // The queued write is dropped, so it cannot recreate the draft row that
    // sending just deleted and leave sent text looking unsent.
    expect(sent).toHaveLength(0);
  });

  it("still saves edits made after a rewrite", async () => {
    const { autosave, sent } = harness();
    autosave.edit("m1", "the old wording");
    autosave.invalidate("m1");
    autosave.edit("m1", "the new wording, tweaked");
    vi.advanceTimersByTime(900);
    await autosave.settled();

    expect(sent.map((s) => s.body)).toEqual(["the new wording, tweaked"]);
  });
});

describe("when saving fails", () => {
  it("swallows the error rather than throwing at the operator", async () => {
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    const autosave = createDraftAutosave({ send, delayMs: 10 });
    autosave.edit("m1", "text");
    vi.advanceTimersByTime(10);
    // The text is still in the box in front of them; an alert would be noise.
    await expect(autosave.settled()).resolves.toBeUndefined();
  });

  it("keeps saving after a failure instead of wedging the queue", async () => {
    let calls = 0;
    const bodies: string[] = [];
    const send = vi.fn(async (s: Sent) => {
      calls++;
      if (calls === 1) throw new Error("offline");
      bodies.push(s.body);
    });
    const autosave = createDraftAutosave({ send, delayMs: 10 });
    autosave.edit("m1", "first");
    vi.advanceTimersByTime(10);
    await autosave.settled();
    autosave.edit("m1", "second");
    vi.advanceTimersByTime(10);
    await autosave.settled();

    expect(bodies).toEqual(["second"]);
  });
});
