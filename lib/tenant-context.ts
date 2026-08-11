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
