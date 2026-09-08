/**
 * Resolve the active tenant org for UI data access. Prefers ALS (agents), then
 * the signed-in user's membership. Throws when neither is available so list
 * queries cannot accidentally return another tenant's rows.
 */
import { currentUser } from "./auth";
import { currentOrgId, LEGACY_ORG_ID } from "./tenant-context";

/** A real absence of request/job tenant context, not a failed tenant read. */
export class MissingTenantContextError extends Error {
  constructor() {
    super("No organization context.");
    this.name = "MissingTenantContextError";
  }
}

export async function resolveTenantOrgId(opts?: {
  /** Allow legacy fallback when tables are mid-migration (default false in prod). */
  allowLegacyFallback?: boolean;
}): Promise<string> {
  const fromAls = currentOrgId();
  if (fromAls) return fromAls;
  // A rejected session/membership read is an outage, not an unauthenticated
  // request. Strict callers must be able to distinguish it from a real null.
  const user = await currentUser();
  if (user?.organizationId) return user.organizationId;
  if (opts?.allowLegacyFallback) return LEGACY_ORG_ID;
  throw new MissingTenantContextError();
}

export async function tryResolveTenantOrgId(): Promise<string | null> {
  try {
    // "Try" means return null when there is no authenticated or job-scoped
    // tenant. It must never turn an orphaned session or public request into
    // the founding customer. The explicit legacy option remains only for
    // tightly controlled migration/bootstrap callers.
    return await resolveTenantOrgId();
  } catch (error) {
    if (error instanceof MissingTenantContextError) return null;
    throw error;
  }
}
