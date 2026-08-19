/**
 * Boot must be able to describe itself.
 *
 * The worker once got two lines into starting and then went quiet for eight
 * hours: alive, doing nothing, with no error anywhere because nothing ever
 * threw. Every await in that sequence is now bounded and narrated, and the one
 * step the process cannot do without, the queue connection, is retried instead
 * of awaited once.
 */
import { describe, it, expect, vi } from "vitest";
import {
  BootStepTimeoutError,
  backoffDelay,
  bootStep,
  retryForever,
  withTimeout,
} from "@/lib/boot-step";

const never = () => new Promise<never>(() => {});

describe("a step that stalls", () => {
  it("ends with a named timeout instead of hanging", async () => {
    await expect(withTimeout(never(), 10, "queue")).rejects.toBeInstanceOf(BootStepTimeoutError);
  });

  it("says which step stalled and for how long", async () => {
    const lines: string[] = [];
    await expect(
      bootStep("migrations", never, { timeoutMs: 10, log: (l) => lines.push(l) })
    ).rejects.toThrow(/migrations did not finish/);
    expect(lines[0]).toContain("migrations: starting");
    expect(lines.at(-1)).toContain("STALLED");
  });

  it("reports the phase the moment the step starts, not when it finishes", async () => {
    const phases: string[] = [];
    const p = bootStep("queue", never, {
      timeoutMs: 10,
      log: () => {},
      onPhase: (name) => phases.push(name),
    });
    expect(phases).toEqual(["queue"]);
    await expect(p).rejects.toThrow();
  });
});

describe("a step that works", () => {
  it("returns the value and logs how long it took", async () => {
    const lines: string[] = [];
    const out = await bootStep("handlers", async () => 32, {
      timeoutMs: 1000,
      log: (l) => lines.push(l),
    });
    expect(out).toBe(32);
    expect(lines.at(-1)).toMatch(/handlers: ok in/);
  });

  it("does not fire the timeout after it has settled", async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(Promise.resolve("done"), 50, "queue");
      await expect(p).resolves.toBe("done");
      vi.advanceTimersByTime(500);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the queue connection", () => {
  it("keeps trying until it connects", async () => {
    const sleep = vi.fn(async () => {});
    const cleanup = vi.fn();
    let attempts = 0;
    const queue = await retryForever(
      "queue",
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("connection terminated");
        return "connected";
      },
      { baseDelayMs: 1000, maxDelayMs: 60_000, log: () => {}, sleep, onRetry: cleanup }
    );
    expect(queue).toBe("connected");
    expect(attempts).toBe(3);
    // The half-started backend is dropped before each new attempt, otherwise
    // the retry reconnects nothing.
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("backs off but never waits longer than the cap", () => {
    expect(backoffDelay(1, 5_000, 60_000)).toBe(5_000);
    expect(backoffDelay(2, 5_000, 60_000)).toBe(10_000);
    expect(backoffDelay(20, 5_000, 60_000)).toBe(60_000);
  });

  it("still gives up when the caller sets a limit", async () => {
    await expect(
      retryForever("queue", async () => Promise.reject(new Error("nope")), {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        log: () => {},
        sleep: async () => {},
      })
    ).rejects.toThrow("nope");
  });
});
