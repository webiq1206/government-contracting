/**
 * A record of what administrators did to other people's accounts.
 *
 * Cross-tenant power is the one place in this product where an action has no
 * natural witness: the customer cannot see it, and the admin is the person who
 * would otherwise be trusted to remember it. So every action writes a row
 * here, and the row survives the thing it describes — the org id is a plain
 * column rather than a foreign key precisely so that deleting an account does
 * not erase the evidence that it was deleted.
 *
 * Append-only by convention. There is no update or delete path in the
 * application.
 */
import { query } from "../db";

export type AdminAction =
  | "billing_exempt_granted"
  | "billing_exempt_revoked"
  | "trial_extended"
  | "trial_restarted"
  | "subscription_canceled"
  | "account_suspended"
  | "account_reactivated"
  | "account_deleted"
  // The scheduling and the purge are separate entries on purpose. One is a
  // decision somebody made and could still take back; the other is the moment
  // the data actually went, and the gap between them is the whole point of the
  // grace period.
  | "account_deletion_scheduled"
  | "account_deletion_cancelled"
  | "impersonation_started"
  | "impersonation_ended"
  | "discount_applied"
  | "free_months_granted"
  | "discount_removed"
  | "invitation_created"
  | "invitation_resent"
  | "invitation_revoked"
  | "invitation_accepted"
  // Terms that were agreed but never landed, put right after the fact. Worth
  // its own entry: the money changed without an admin pressing anything.
  | "invitation_terms_repaired"
  // Lending a platform credential spends our money under someone else's
  // account, so who did it and why is part of the record, not a note.
  | "platform_key_granted"
  | "platform_key_revoked";

export interface AdminAuditEntry {
  id: string;
  admin_email: string;
  action: AdminAction;
  target_org_id: string | null;
  target_org_name: string | null;
  target_user_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export async function recordAdminAction(input: {
  adminEmail: string;
  action: AdminAction;
  orgId?: string | null;
  orgName?: string | null;
  userId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  // Never allowed to fail the action it describes: an admin unsuspending a
  // locked-out customer should not be stopped by an audit write. Logged loudly
  // instead, because a silent gap in this table is worth noticing.
  await query(
    `insert into admin_audit_log
       (admin_email, action, target_org_id, target_org_name, target_user_id, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.adminEmail,
      input.action,
      input.orgId ?? null,
      input.orgName ?? null,
      input.userId ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
    ]
  ).catch((err) => console.error("[admin-audit] failed to record", input.action, err));
}

export async function recentAdminActions(
  limit = 50,
  opts?: { includeTestAccounts?: boolean }
): Promise<AdminAuditEntry[]> {
  /*
   * The audit log is append-only and keeps rows for accounts that no longer
   * exist, which is the point -- deleting an account must not erase the
   * evidence that it was deleted. The consequence is that every test
   * organization ever created and torn down is still in here, and on a
   * production admin screen that reads as real history: a reviewer scrolling
   * "recent admin actions" saw suspensions and deletions of accounts that
   * were never customers, mixed in with ones that were.
   *
   * Nothing is deleted to fix that. The rows are filtered out of the default
   * view by the same matcher the purge tool uses, and `includeTestAccounts`
   * brings them back for anyone who genuinely wants the raw log.
   */
  const rows = await query<AdminAuditEntry>(
    `select id, admin_email, action, target_org_id, target_org_name,
            target_user_id, detail, created_at
       from admin_audit_log
      order by created_at desc
      limit $1`,
    // Over-fetch so filtering does not leave a short page.
    [opts?.includeTestAccounts ? limit : limit * 4]
  ).catch(() => []);

  if (opts?.includeTestAccounts) return rows;

  const { looksLikeTestOrg, looksLikeTestEmail } = await import("../domain/test-org-match");
  /*
   * Two signals, because one of them cannot see half the rows.
   *
   * The name matcher only fires on a target organization, and an invitation
   * action has none: revoking an invitation records the administrator and the
   * invited address and nothing else. So every invitation the suite ever
   * created and revoked sat in the production view looking like real history,
   * which is the exact problem this filter exists to solve, on the rows it
   * could not reach.
   *
   * The acting address settles it. `.test` and the `example.*` domains are
   * reserved by RFC 2606 and cannot be registered, so an administrator at one
   * is a fixture with certainty rather than by inference.
   */
  return rows
    .filter(
      (r) =>
        !(r.target_org_name && looksLikeTestOrg(r.target_org_name)) &&
        !looksLikeTestEmail(r.admin_email)
    )
    .slice(0, limit);
}

export async function adminActionsForOrg(
  orgId: string,
  limit = 25
): Promise<AdminAuditEntry[]> {
  return query<AdminAuditEntry>(
    `select id, admin_email, action, target_org_id, target_org_name,
            target_user_id, detail, created_at
       from admin_audit_log
      where target_org_id = $1
      order by created_at desc
      limit $2`,
    [orgId, limit]
  ).catch(() => []);
}
