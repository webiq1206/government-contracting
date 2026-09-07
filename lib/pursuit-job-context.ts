import { AsyncLocalStorage } from "node:async_hooks";

interface PursuitJobStore {
  opportunityId: string;
  version: number;
}

const pursuitJob = new AsyncLocalStorage<PursuitJobStore>();

/** Carry the queue-time pursuit version through late send and enqueue guards. */
export function runWithPursuitVersion<T>(
  store: PursuitJobStore,
  fn: () => T
): T {
  return pursuitJob.run(store, fn);
}

/** Return an expectation only for the opportunity the current job owns. */
export function expectedPursuitVersion(opportunityId: string): number | null {
  const current = pursuitJob.getStore();
  return current?.opportunityId === opportunityId ? current.version : null;
}
