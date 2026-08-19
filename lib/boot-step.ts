/**
 * Boot narration for long-lived processes.
 *
 * The worker once started, printed two lines, and then produced no output for
 * eight hours. It had not crashed (the web half of the same process kept
 * serving) and it had not finished starting either: it was parked inside one
 * `await` that never settled, most likely a database call on a socket that
 * died mid-flight. Nothing in the log said which call, because a boot that
 * only logs its result says nothing at all while it is stuck.
 *
 * So every boot step announces itself before it runs, reports how long it
 * took, and is bounded by a timeout. A step that stalls now ends with a named
 * error instead of silence, and the caller decides whether to retry it or move
 * on. Pure timing and control flow, no I/O, so it is testable on its own.
 */

export class BootStepTimeoutError extends Error {
  constructor(
    readonly step: string,
    readonly timeoutMs: number
  ) {
    super(`${step} did not finish within ${Math.round(timeoutMs / 1000)}s`);
    this.name = "BootStepTimeoutError";
  }
}

export interface BootStepOptions {
  /** Hard ceiling for the step. */
  timeoutMs: number;
  /** Where narration goes. Defaults to the console. */
  log?: (line: string) => void;
  /** Called with the step name the moment it starts, for the heartbeat. */
  onPhase?: (step: string) => void;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/**
 * Reject after `timeoutMs` if the promise has not settled.
 *
 * The underlying work is not cancelled, nothing here can cancel a query that
 * is already on the wire. The point is that the *caller* stops waiting and can
 * say so out loud.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  step: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BootStepTimeoutError(step, timeoutMs)), timeoutMs);
    // Never hold the event loop open for the sake of the watchdog itself.
    if (typeof timer.unref === "function") timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Run one named boot step: announce, time, bound, report. */
export async function bootStep<T>(
  name: string,
  fn: () => Promise<T>,
  opts: BootStepOptions
): Promise<T> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? (() => Date.now());
  opts.onPhase?.(name);
  const started = now();
  const secs = () => ((now() - started) / 1000).toFixed(1);
  log(`[worker] ${name}: starting`);
  try {
    const out = await withTimeout(fn(), opts.timeoutMs, name);
    log(`[worker] ${name}: ok in ${secs()}s`);
    return out;
  } catch (err) {
    const why = err instanceof BootStepTimeoutError ? "STALLED" : "failed";
    log(`[worker] ${name}: ${why} after ${secs()}s: ${(err as Error).message}`);
    throw err;
  }
}

export interface RetryOptions {
  /** Attempt numbers are 1-based; 0 or undefined means keep trying forever. */
  maxAttempts?: number;
  /** First backoff, doubled each attempt up to `maxDelayMs`. */
  baseDelayMs: number;
  maxDelayMs: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Cleanup between attempts, e.g. dropping a half-started singleton. */
  onRetry?: (attempt: number, err: unknown) => Promise<void> | void;
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

/**
 * Keep trying until it works.
 *
 * Used for the queue connection, which is the difference between a worker
 * that does nothing and a worker that works. If Postgres is briefly
 * unreachable at boot, giving up leaves a live process that will never run a
 * job again until a human notices; retrying costs a log line a minute.
 */
export async function retryForever<T>(
  name: string,
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (opts.maxAttempts && attempt >= opts.maxAttempts) throw err;
      const wait = backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      log(
        `[worker] ${name}: attempt ${attempt} failed (${(err as Error).message}), retrying in ${Math.round(
          wait / 1000
        )}s`
      );
      await opts.onRetry?.(attempt, err);
      await sleep(wait);
    }
  }
}
