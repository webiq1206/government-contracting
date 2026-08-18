/**
 * Request/job-scoped organization context via AsyncLocalStorage.
 * UI resolves org from the session; agents wrap work in runWithOrg().
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const LEGACY_ORG_ID = "00000000-0000-4000-8000-000000000001";

type Store = { orgId: string };

const als = new AsyncLocalStorage<Store>();

export function runWithOrg<T>(orgId: string, fn: () => T): T {
  return als.run({ orgId }, fn);
}

export function currentOrgId(): string | null {
  return als.getStore()?.orgId ?? null;
}

export function requireContextOrgId(): string {
  const id = currentOrgId();
  if (!id) throw new Error("Organization context is not set for this operation.");
  return id;
}

/**
 * The organization we are acting on behalf of right now, from either source.
 *
 * A job gets its context from the runner. Work done while serving a request
 * has no context set, so fall back to the signed-in user. The auth import is
 * lazy because the worker has no request to read, and importing it eagerly
 * would pull request plumbing into a process that has none.
 */
export async function actingOrgId(): Promise<string | null> {
  const fromAls = currentOrgId();
  if (fromAls) return fromAls;
  try {
    const { currentUser } = await import("./auth");
    const user = await currentUser().catch(() => null);
    return user?.organizationId ?? null;
  } catch {
    return null;
  }
}
