/**
 * Resolve the active tenant org for UI data access. Prefers ALS (agents), then
 * the signed-in user's membership. Throws when neither is available so list
 * queries cannot accidentally return another tenant's rows.
 */
import { currentUser } from "./auth";
import { currentOrgId, LEGACY_ORG_ID } from "./tenant-context";

export async function resolveTenantOrgId(opts?: {
  /** Allow legacy fallback when tables are mid-migration (default false in prod). */
  allowLegacyFallback?: boolean;
}): Promise<string> {
  const fromAls = currentOrgId();
  if (fromAls) return fromAls;
  const user = await currentUser().catch(() => null);
  if (user?.organizationId) return user.organizationId;
  if (opts?.allowLegacyFallback) return LEGACY_ORG_ID;
  throw new Error("No organization context.");
}

export async function tryResolveTenantOrgId(): Promise<string | null> {
  try {
    return await resolveTenantOrgId({ allowLegacyFallback: true });
  } catch {
    return null;
  }
}
