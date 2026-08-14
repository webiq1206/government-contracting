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
  | "impersonation_started"
  | "impersonation_ended"
  | "discount_applied"
  | "free_months_granted"
  | "discount_removed"
  | "invitation_created"
  | "invitation_resent"
  | "invitation_revoked"
  | "invitation_accepted";

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

export async function recentAdminActions(limit = 50): Promise<AdminAuditEntry[]> {
  return query<AdminAuditEntry>(
    `select id, admin_email, action, target_org_id, target_org_name,
            target_user_id, detail, created_at
       from admin_audit_log
      order by created_at desc
      limit $1`,
    [limit]
  ).catch(() => []);
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
