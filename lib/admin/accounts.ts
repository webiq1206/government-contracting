/**
 * Cross-tenant account administration.
 *
 * Reads and writes across every organization, so nothing in here is reachable
 * without `requirePlatformAdmin`. Kept apart from lib/organizations.ts on
 * purpose: that module is tenant-scoped and its functions are safe to call
 * from ordinary customer code paths. These are not, and having them in a
 * separate file named `admin` makes an accidental import obvious in review.
 */
import { query, queryOne } from "../db";
import { accessLevel, type AccessLevel } from "../billing/entitlements";
import { TRIAL_DAYS } from "../billing/catalog";
import { recordAdminAction } from "./audit";

export interface AdminAccountRow {
  id: string;
  name: string;
  subscription_status: string | null;
  plan_key: string | null;
  trial_ends_at: string | null;
  billing_exempt: boolean;
  billing_exempt_reason: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** What Stripe reports today. */
  discount_code: string | null;
  discount_percent_off: number | null;
  discount_amount_off_cents: number | null;
  discount_ends_at: string | null;
  /** What we promised an account that has not checked out yet. */
  pending_concession_code: string | null;
  pending_concession_label: string | null;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  owner_user_id: string | null;
  member_count: number;
  /** Computed, never stored: what this account can actually do right now. */
  access: AccessLevel;
}

const ACCOUNT_SELECT = `
  select o.id,
         o.name,
         o.subscription_status,
         o.plan_key,
         o.trial_ends_at::text  as trial_ends_at,
         o.billing_exempt,
         o.billing_exempt_reason,
         o.suspended_at::text   as suspended_at,
         o.suspended_reason,
         o.stripe_customer_id,
         o.stripe_subscription_id,
         o.discount_code,
         o.discount_percent_off,
         o.discount_amount_off_cents,
         o.discount_ends_at::text as discount_ends_at,
         o.pending_concession_code,
         o.pending_concession_label,
         o.created_at::text     as created_at,
         owner.email            as owner_email,
         owner.name             as owner_name,
         owner.id               as owner_user_id,
         (select count(*) from organization_members m where m.org_id = o.id)::int
                                as member_count
    from organizations o
    -- One owner row even when an organization has several. Oldest membership
    -- wins so the answer is stable between page loads rather than whichever
    -- row the planner happened to return first.
    left join lateral (
      select u.id, u.email, u.name
        from organization_members m
        join users u on u.id = m.user_id
       where m.org_id = o.id and m.role = 'owner'
       order by m.created_at asc
       limit 1
    ) owner on true`;

function withAccess<T extends Omit<AdminAccountRow, "access">>(row: T): T & { access: AccessLevel } {
  return { ...row, access: accessLevel(row) };
}

/**
 * Every account, problems first.
 *
 * Ordered by how likely the row is to be why the page was opened: suspended
 * and locked-out accounts before healthy ones. A working account is never the
 * reason anyone comes here.
 */
export async function adminAccountRows(): Promise<AdminAccountRow[]> {
  const rows = await query<Omit<AdminAccountRow, "access">>(
    `${ACCOUNT_SELECT} order by o.created_at desc`
  ).catch(() => []);

  const rank = (r: AdminAccountRow) =>
    r.suspended_at ? 0 : r.access === "none" ? 1 : r.access === "trial" ? 2 : 3;

  return rows
    .map(withAccess)
    .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
}

export async function adminAccount(orgId: string): Promise<AdminAccountRow | null> {
  const row = await queryOne<Omit<AdminAccountRow, "access">>(
    `${ACCOUNT_SELECT} where o.id = $1`,
    [orgId]
  ).catch(() => null);
  return row ? withAccess(row) : null;
}

export interface AdminAccountMember {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
  aliases: string[];
}

export async function adminAccountMembers(orgId: string): Promise<AdminAccountMember[]> {
  return query<AdminAccountMember>(
    `select u.id as user_id, u.email, u.name, m.role, m.created_at::text as created_at,
            coalesce(
              (select array_agg(a.email order by a.email)
                 from user_email_aliases a where a.user_id = u.id),
              '{}'
            ) as aliases
       from organization_members m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by case m.role when 'owner' then 0 else 1 end, u.email`,
    [orgId]
  ).catch(() => []);
}

/* -------------------------------------------------------------------------
 * Actions
 *
 * Each one takes the acting admin's email, writes an audit row, and returns a
 * plain result rather than throwing, so the route can turn it into a message.
 * ---------------------------------------------------------------------- */

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Is this one of our own organizations?
 *
 * Comping our own account or extending its trial is fine, but revoking its
 * comp, suspending it or deleting it would lock us out of the product we use
 * to administer everything else, and the only way back would be a
 * hand-written SQL statement against production. The whole point of this
 * feature was to stop the owner losing access to his own account, so the
 * feature refuses to be the thing that does it.
 *
 * Ownership, specifically, not membership. If an administrator is ever added
 * to a customer's organization to help with something, that customer's
 * account must stay fully manageable; protecting every tenant an admin
 * happens to belong to would quietly make real accounts unsuspendable and
 * undeletable.
 */
async function isOwnAccount(orgId: string): Promise<boolean> {
  const { isPlatformAdmin } = await import("../platform-admin");
  const owners = await query<{ email: string }>(
    `select u.email
       from organization_members m join users u on u.id = m.user_id
      where m.org_id = $1 and m.role = 'owner'`,
    [orgId]
  ).catch(() => []);
  return owners.some((m) => isPlatformAdmin(m.email));
}

async function orgNameOf(orgId: string): Promise<string | null> {
  const row = await queryOne<{ name: string }>(
    `select name from organizations where id = $1`,
    [orgId]
  ).catch(() => null);
  return row?.name ?? null;
}

/** Comp an account, or take the comp away. */
export async function setBillingExempt(input: {
  orgId: string;
  exempt: boolean;
  reason: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const name = await orgNameOf(input.orgId);
  if (!name) return { ok: false, error: "That account no longer exists." };
  if (input.exempt && !input.reason.trim()) {
    // A comp with no reason becomes unexplainable the moment the person who
    // granted it forgets, and nobody is then willing to revoke it.
    return { ok: false, error: "Say why this account is comped." };
  }
  if (!input.exempt && (await isOwnAccount(input.orgId))) {
    return {
      ok: false,
      error: `${name} is our own account. Removing its comp would put it behind the paywall it is meant to be exempt from.`,
    };
  }

  await query(
    `update organizations
        set billing_exempt = $2,
            billing_exempt_reason = case when $2 then $3 else null end,
            billing_exempt_granted_by = case when $2 then $4 else null end,
            billing_exempt_granted_at = case when $2 then now() else null end,
            updated_at = now()
      where id = $1`,
    [input.orgId, input.exempt, input.reason.trim() || null, input.adminEmail]
  );

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: input.exempt ? "billing_exempt_granted" : "billing_exempt_revoked",
    orgId: input.orgId,
    orgName: name,
    detail: { reason: input.reason.trim() || null },
  });

  return {
    ok: true,
    message: input.exempt
      ? `${name} is comped and will not be billed.`
      : `${name} is back on normal billing.`,
  };
}

/**
 * Push a trial's end date out.
 *
 * Extends from whichever is later, today or the current end date, so
 * extending a trial that already lapsed gives the full extra window rather
 * than silently adding days to a date in the past.
 */
export async function extendTrial(input: {
  orgId: string;
  days: number;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const days = Math.round(input.days);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return { ok: false, error: "Choose between 1 and 365 days." };
  }
  const name = await orgNameOf(input.orgId);
  if (!name) return { ok: false, error: "That account no longer exists." };

  const row = await queryOne<{ trial_ends_at: string }>(
    `update organizations
        set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now())
                            + make_interval(days => $2::int),
            subscription_status = 'trial',
            updated_at = now()
      where id = $1
      returning trial_ends_at::text as trial_ends_at`,
    [input.orgId, days]
  );

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "trial_extended",
    orgId: input.orgId,
    orgName: name,
    detail: { days, new_trial_ends_at: row?.trial_ends_at ?? null },
  });

  return { ok: true, message: `${name}'s trial now runs ${days} more day${days === 1 ? "" : "s"}.` };
}

/** Start the standard trial over from today. */
export async function restartTrial(input: {
  orgId: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const name = await orgNameOf(input.orgId);
  if (!name) return { ok: false, error: "That account no longer exists." };

  await query(
    `update organizations
        set trial_ends_at = now() + make_interval(days => $2::int),
            subscription_status = 'trial',
            updated_at = now()
      where id = $1`,
    [input.orgId, TRIAL_DAYS]
  );

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "trial_restarted",
    orgId: input.orgId,
    orgName: name,
    detail: { days: TRIAL_DAYS },
  });

  return { ok: true, message: `${name} has a fresh ${TRIAL_DAYS}-day trial.` };
}

/**
 * Cancel the subscription.
 *
 * Cancels at Stripe when there is a subscription to cancel, then writes our
 * own status. If the Stripe call fails, our status is left alone and the admin
 * is told: recording a cancellation we did not manage to make is how an
 * account ends up locked out while still being charged.
 */
export async function cancelSubscription(input: {
  orgId: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const org = await adminAccount(input.orgId);
  if (!org) return { ok: false, error: "That account no longer exists." };

  let stripeNote = "No Stripe subscription was attached.";
  if (org.stripe_subscription_id) {
    const { getStripe } = await import("../billing/stripe");
    const stripe = getStripe();
    if (!stripe) {
      return {
        ok: false,
        error:
          "Stripe is not configured here, and this account has a live subscription. Cancel it in the Stripe dashboard instead of leaving the two out of step.",
      };
    }
    try {
      await stripe.subscriptions.cancel(org.stripe_subscription_id);
      stripeNote = "Cancelled at Stripe.";
    } catch (err) {
      return {
        ok: false,
        error: `Stripe refused the cancellation: ${
          err instanceof Error ? err.message : String(err)
        }. Nothing was changed here.`,
      };
    }
  }

  await query(
    `update organizations
        set subscription_status = 'canceled',
            cancel_at_period_end = false,
            updated_at = now()
      where id = $1`,
    [input.orgId]
  );

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "subscription_canceled",
    orgId: input.orgId,
    orgName: org.name,
    detail: { stripe: stripeNote },
  });

  return { ok: true, message: `${org.name}'s subscription is cancelled. ${stripeNote}` };
}

/**
 * Suspend or reinstate an account.
 *
 * Suspension stops access and nothing else. No data is touched, so it is the
 * right answer to almost everything that feels like it needs a delete, and it
 * is reversible in one click by the person who did it.
 */
export async function setSuspended(input: {
  orgId: string;
  suspended: boolean;
  reason: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const name = await orgNameOf(input.orgId);
  if (!name) return { ok: false, error: "That account no longer exists." };
  if (input.suspended && !input.reason.trim()) {
    return { ok: false, error: "Say why this account is being suspended." };
  }
  if (input.suspended && (await isOwnAccount(input.orgId))) {
    return {
      ok: false,
      error: `${name} is our own account. Suspending it would sign us out of the admin tools needed to undo it.`,
    };
  }

  await query(
    `update organizations
        set suspended_at = case when $2 then now() else null end,
            suspended_reason = case when $2 then $3 else null end,
            suspended_by = case when $2 then $4 else null end,
            updated_at = now()
      where id = $1`,
    [input.orgId, input.suspended, input.reason.trim() || null, input.adminEmail]
  );

  if (input.suspended) {
    // Sign them out. Leaving live sessions running would mean a suspended
    // account keeps working until each tab happens to reload.
    await query(
      `delete from sessions
        where user_id in (select user_id from organization_members where org_id = $1)`,
      [input.orgId]
    ).catch(() => {});
  }

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: input.suspended ? "account_suspended" : "account_reactivated",
    orgId: input.orgId,
    orgName: name,
    detail: { reason: input.reason.trim() || null },
  });

  return {
    ok: true,
    message: input.suspended
      ? `${name} is suspended. Their data is untouched.`
      : `${name} is active again.`,
  };
}

/**
 * Remove every row an organization owns, then the organization itself.
 *
 * Roughly thirty tables carry an org_id and most of their foreign keys are ON
 * DELETE NO ACTION, so there is no single statement that does this. Rather
 * than hand-maintain a dependency order that a new table would silently break,
 * the deletes run in repeated passes: anything that fails on a foreign key is
 * retried on the next pass, once whatever depended on it is gone. It either
 * converges or the whole transaction rolls back, which is the only acceptable
 * pair of outcomes — a half-deleted tenant is worse than either.
 *
 * Exported without the confirmation guards that wrap it in deleteAccount, so
 * integration tests can clean up the way the product does. They had been
 * issuing a bare `delete from organizations` with the error swallowed, which
 * fails on the first child row and leaks the whole account: one suite was
 * quietly leaving nine organizations behind per run, and the admin accounts
 * page had accumulated a hundred and ninety-eight of them.
 */
export async function purgeOrganization(orgId: string): Promise<void> {
  const { transaction } = await import("../db");
  await transaction(async (tx) => {
    // File bytes first, while the documents that name them still exist. Legacy
    // blobs were written with a null org_id, so path-join to this org's
    // document rows catches them; the org_id match catches everything written
    // since. Both run before the generic loop deletes documents below.
    await tx.query(
      `delete from file_blobs b
        where b.org_id = $1
           or b.path in (
                select storage_path from documents where org_id = $1 and storage_path is not null
                union
                select storage_path from subcontractor_documents where org_id = $1 and storage_path is not null
              )`,
      [orgId]
    ).catch(() => {});

    const tables = await tx.query<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and c.column_name = 'org_id'
          and t.table_type = 'BASE TABLE'
          and c.table_name <> 'admin_audit_log'`
    );

    let remaining = tables.rows.map((t) => t.table_name);
    // Bounded so a genuine cycle fails fast instead of spinning.
    for (let pass = 0; pass < 12 && remaining.length > 0; pass++) {
      const failed: string[] = [];
      for (const table of remaining) {
        // Each attempt gets a savepoint. Without one, the first foreign-key
        // error would put the whole transaction into an aborted state and
        // every later statement — including the retries this loop exists
        // for — would fail with "current transaction is aborted".
        await tx.query("savepoint del_pass");
        try {
          await tx.query(`delete from "${table}" where org_id = $1`, [orgId]);
          await tx.query("release savepoint del_pass");
        } catch {
          await tx.query("rollback to savepoint del_pass");
          failed.push(table);
        }
      }
      if (failed.length === remaining.length) {
        throw new Error(
          `Could not clear ${failed.join(", ")}: something still references those rows.`
        );
      }
      remaining = failed;
    }
    if (remaining.length > 0) {
      throw new Error(`Gave up clearing ${remaining.join(", ")}.`);
    }

    await tx.query(`delete from organizations where id = $1`, [orgId]);
  });
}

/**
 * Delete an account and everything in it. Irreversible.
 *
 * The guards are the point of this wrapper: it refuses our own account, and it
 * requires the name typed back exactly. purgeOrganization does the work.
 */
export async function deleteAccount(input: {
  orgId: string;
  confirmName: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const org = await adminAccount(input.orgId);
  if (!org) return { ok: false, error: "That account no longer exists." };

  if (await isOwnAccount(input.orgId)) {
    return {
      ok: false,
      error: `${org.name} is our own account and cannot be deleted from here.`,
    };
  }

  // Typing the name is the whole safety mechanism. Deliberately not a
  // yes/no confirm: this cannot be undone and a misclick should not reach it.
  if (input.confirmName.trim() !== org.name) {
    return {
      ok: false,
      error: `Type the account name exactly ("${org.name}") to confirm deletion.`,
    };
  }

  try {
    await purgeOrganization(input.orgId);
  } catch (err) {
    return {
      ok: false,
      error: `Nothing was deleted. ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Written after the fact and outside the transaction, so the record of the
  // deletion cannot be rolled back along with it.
  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "account_deleted",
    orgId: input.orgId,
    orgName: org.name,
    detail: { owner_email: org.owner_email, member_count: org.member_count },
  });

  return { ok: true, message: `${org.name} and all of its data are gone.` };
}
