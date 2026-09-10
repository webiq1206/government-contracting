/**
 * Cross-tenant account administration.
 *
 * Reads and writes across every organization, so nothing in here is reachable
 * without `requirePlatformAdmin`. Kept apart from lib/organizations.ts on
 * purpose: that module is tenant-scoped and its functions are safe to call
 * from ordinary customer code paths. These are not, and having them in a
 * separate file named `admin` makes an accidental import obvious in review.
 */
import { query, queryOne, transaction } from "../db";
import { accessLevel, type AccessLevel } from "../billing/entitlements";
import { TRIAL_DAYS } from "../billing/catalog";
import { recordRequiredAdminAction } from "./audit";
import { storage, type StorageBackend } from "../integrations/storage";
import { isPlatformAdmin } from "../platform-admin";
import { parsePaging, type FilterValues, type SortState } from "../domain/table-view";

export const ACCOUNT_SORT_KEYS = ["name", "owner_email", "access", "subscription_status", "plan_key", "member_count", "created_at", "last_active_at"];

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
  /**
   * The most recent sign-in by anybody in this account, or null if nobody
   * ever has. Read from sessions rather than from a "last seen" column,
   * because a column would need writing on every request and this is the one
   * page that ever asks.
   */
  last_active_at: string | null;
  /** Set when a deletion has been scheduled but the grace period has not run out. */
  deletion_scheduled_at: string | null;
  deletion_requested_by: string | null;
  deletion_reason: string | null;
  /**
   * customer | internal | test.
   *
   * Explicit, never inferred from the name: guessing classifies a company
   * called Test Valley Contractors as a fixture, and nothing about that
   * failure announces itself. Set by an administrator on the account.
   */
  classification: string;
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
         o.deletion_scheduled_at::text as deletion_scheduled_at,
         o.deletion_requested_by,
         o.deletion_reason,
         o.classification,
         owner.email            as owner_email,
         owner.name             as owner_name,
         owner.id               as owner_user_id,
         (select count(*) from organization_members m where m.org_id = o.id)::int
                                as member_count,
         -- Newest session created for anybody in this account. Impersonated
         -- sessions are excluded: an administrator opening a support session
         -- is not the customer using their account, and counting it would
         -- make every account somebody investigated look freshly active.
         (select max(s.created_at)::text
            from sessions s
            join organization_members m2 on m2.user_id = s.user_id
           where m2.org_id = o.id and s.impersonator_user_id is null)
                                as last_active_at
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
  );

  const rank = (r: AdminAccountRow) =>
    r.suspended_at ? 0 : r.access === "none" ? 1 : r.access === "trial" ? 2 : 3;

  return rows
    .map(withAccess)
    .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
}

/** Filter, count and page in one database snapshot. Only the visible accounts
 * receive the full detail projection and cross the database connection. */
export async function adminAccountPage(
  filters: FilterValues,
  sort: SortState,
  params: Record<string, string | string[] | undefined>,
) {
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const kind = filters.kind ?? "customer";
  const kindClause = kind === "all" ? "true" : `f.classification = ${bind(kind)}`;
  const clauses = [kindClause];
  if (filters.q) clauses.push(`position(lower(${bind(filters.q)}) in lower(f.name || ' ' || coalesce(f.owner_email,''))) > 0`);
  if (filters.access) clauses.push(`f.access = ${bind(filters.access)}`);
  if (filters.billing === "comped") clauses.push("f.billing_exempt");
  if (filters.billing === "paying") clauses.push("not f.billing_exempt and nullif(f.subscription_status,'') is not null");
  if (filters.billing === "none") clauses.push("nullif(f.subscription_status,'') is null");
  if (filters.suspended === "1") clauses.push("f.suspended_at is not null");
  if (filters.noowner === "1") clauses.push("nullif(f.owner_email,'') is null");
  if (filters.trial === "1") clauses.push("f.access = 'trial'");
  if (filters.plan === "none") clauses.push("coalesce(nullif(f.plan_key,''),'none') = 'none'");
  else if (filters.plan) clauses.push(`f.plan_key = ${bind(filters.plan)}`);
  if (filters.signup && ["7", "30", "90"].includes(filters.signup)) clauses.push(`f.created_at >= now() - ${bind(Number(filters.signup))}::int * interval '1 day'`);
  if (filters.activity === "never") clauses.push("f.last_active_at is null");
  if (filters.activity === "dormant") clauses.push("f.last_active_at <= now() - interval '30 days'");
  if (filters.activity === "quiet") clauses.push("f.last_active_at > now() - interval '30 days' and f.last_active_at <= now() - interval '7 days'");
  if (filters.activity === "active") clauses.push("f.last_active_at > now() - interval '7 days'");
  const key = sort.key && ACCOUNT_SORT_KEYS.includes(sort.key) ? sort.key : null;
  const direction = sort.direction === "desc" ? "desc" : "asc";
  const order = key
    ? `f.${key} ${direction} ${key === "last_active_at" && direction === "asc" ? "nulls first" : "nulls last"}, f.id`
    : "case when f.suspended_at is not null then 0 when f.access='none' then 1 when f.access='trial' then 2 else 3 end, f.created_at desc, f.id";
  const requested = parsePaging(params, Number.MAX_SAFE_INTEGER);
  const per = bind(requested.perPage);
  const page = bind(requested.page);
  const data = await queryOne<{
    total: number; customers: number; locked_out: number; comped: number;
    suspended: number; never_used: number; hidden: number; rows: AdminAccountRow[];
  }>(`with member_activity as (
      select m.org_id, count(distinct m.user_id)::int as member_count,
             max(s.created_at) as last_active_at
        from organization_members m
        left join sessions s on s.user_id=m.user_id and s.impersonator_user_id is null
       group by m.org_id
    ), facts as materialized (
      select o.id, o.name, o.classification, o.billing_exempt, o.suspended_at,
             o.subscription_status, o.plan_key, o.created_at, owner.email as owner_email,
             coalesce(a.member_count,0) as member_count, a.last_active_at,
             case when o.suspended_at is not null then 'none'
                  when o.billing_exempt or o.subscription_status in ('active','trialing','past_due') then 'full'
                  when o.subscription_status='trial' and o.trial_ends_at > now() then 'trial'
                  else 'none' end as access
        from organizations o
        left join member_activity a on a.org_id=o.id
        left join lateral (
          select u.email from organization_members m join users u on u.id=m.user_id
           where m.org_id=o.id and m.role='owner' order by m.created_at, m.user_id limit 1
        ) owner on true
    ), matched as materialized (
      select f.* from facts f where ${clauses.join(" and ")}
    ), counts as (
      select (select count(*)::int from matched) as total,
             count(*) filter(where classification='customer')::int as customers,
             count(*) filter(where classification='customer' and access='none')::int as locked_out,
             count(*) filter(where classification='customer' and billing_exempt)::int as comped,
             count(*) filter(where classification='customer' and suspended_at is not null)::int as suspended,
             count(*) filter(where classification='customer' and last_active_at is null)::int as never_used,
             count(*) filter(where not (${kindClause}))::int as hidden
        from facts f
    ), page as materialized (
      select f.id, f.access, row_number() over(order by ${order}) as position
        from matched f order by ${order}
       limit ${per}::int
       offset (least(${page}::bigint, greatest(1, ceil((select total from counts)::numeric / ${per}::int)::bigint))-1)*${per}::int
    ), details as (
      ${ACCOUNT_SELECT}
      join page p on p.id=o.id
    )
    select counts.*, coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('access',p.access) order by p.position)
      from details d join page p on p.id=d.id),'[]'::jsonb) as rows from counts`, values);
  if (!data) throw new Error("Account list could not be loaded. Try again.");
  return { ...data, paging: parsePaging(params, data.total) };
}

export async function adminAccount(orgId: string): Promise<AdminAccountRow | null> {
  const row = await queryOne<Omit<AdminAccountRow, "access">>(
    `${ACCOUNT_SELECT} where o.id = $1`,
    [orgId]
  );
  return row ? withAccess(row) : null;
}

async function adminAccountForDestructiveAction(orgId: string): Promise<AdminAccountRow | null> {
  const row = await queryOne<Omit<AdminAccountRow, "access">>(
    `${ACCOUNT_SELECT} where o.id = $1`,
    [orgId]
  );
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
  );
}

/* -------------------------------------------------------------------------
 * Actions
 *
 * Each one takes the acting admin's email, writes an audit row, and returns a
 * plain result rather than throwing, so the route can turn it into a message.
 * ---------------------------------------------------------------------- */

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string };

function rolledBackAdminMutation(label: string, err: unknown): AdminActionResult {
  console.error(`[admin-accounts] ${label} was rolled back`, err);
  return {
    ok: false,
    error: `${label} was not completed because the change and its required audit record could not be saved together. Nothing changed; try again.`,
  };
}

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
  );
  return owners.some((m) => isPlatformAdmin(m.email));
}

async function orgNameOf(orgId: string): Promise<string | null> {
  const row = await queryOne<{ name: string }>(
    `select name from organizations where id = $1`,
    [orgId]
  );
  return row?.name ?? null;
}

/** Comp an account, or take the comp away. */
export async function setBillingExempt(input: {
  orgId: string;
  exempt: boolean;
  reason: string;
  adminEmail: string;
  /** Converting to free also retires any discount promised for checkout. */
  clearPendingConcession?: boolean;
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

  try {
    await transaction(async (client) => {
      const updated = await client.query(
        `update organizations
            set billing_exempt = $2,
                billing_exempt_reason = case when $2 then $3 else null end,
                billing_exempt_granted_by = case when $2 then $4 else null end,
                billing_exempt_granted_at = case when $2 then now() else null end,
                updated_at = now()
          where id = $1
          returning id`,
        [input.orgId, input.exempt, input.reason.trim() || null, input.adminEmail]
      );
      if (updated.rows.length === 0) throw new Error("Account disappeared before update.");
      if (input.clearPendingConcession) {
        await client.query(
          `update organizations
              set pending_concession_code = null,
                  pending_coupon_id = null,
                  pending_concession_label = null,
                  pending_concession_reason = null,
                  pending_concession_by = null,
                  pending_concession_at = null,
                  updated_at = now()
            where id = $1`,
          [input.orgId]
        );
      }
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: input.exempt ? "billing_exempt_granted" : "billing_exempt_revoked",
          orgId: input.orgId,
          orgName: name,
          detail: {
            reason: input.reason.trim() || null,
            cleared_pending_concession: input.clearPendingConcession === true,
          },
        },
        client
      );
    });
  } catch (err) {
    return rolledBackAdminMutation("The billing exemption", err);
  }

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

  try {
    await transaction(async (client) => {
      const updated = await client.query<{ trial_ends_at: string }>(
        `update organizations
            set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now())
                                + make_interval(days => $2::int),
                subscription_status = 'trial',
                updated_at = now()
          where id = $1
          returning trial_ends_at::text as trial_ends_at`,
        [input.orgId, days]
      );
      const row = updated.rows[0];
      if (!row) throw new Error("Account disappeared before update.");
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: "trial_extended",
          orgId: input.orgId,
          orgName: name,
          detail: { days, new_trial_ends_at: row.trial_ends_at },
        },
        client
      );
    });
  } catch (err) {
    return rolledBackAdminMutation("The trial extension", err);
  }

  return { ok: true, message: `${name}'s trial now runs ${days} more day${days === 1 ? "" : "s"}.` };
}

/** Start the standard trial over from today. */
export async function restartTrial(input: {
  orgId: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const name = await orgNameOf(input.orgId);
  if (!name) return { ok: false, error: "That account no longer exists." };

  try {
    await transaction(async (client) => {
      const updated = await client.query(
        `update organizations
            set trial_ends_at = now() + make_interval(days => $2::int),
                subscription_status = 'trial',
                updated_at = now()
          where id = $1
          returning id`,
        [input.orgId, TRIAL_DAYS]
      );
      if (updated.rows.length === 0) throw new Error("Account disappeared before update.");
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: "trial_restarted",
          orgId: input.orgId,
          orgName: name,
          detail: { days: TRIAL_DAYS },
        },
        client
      );
    });
  } catch (err) {
    return rolledBackAdminMutation("The trial restart", err);
  }

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

  try {
    await transaction(async (client) => {
      const updated = await client.query(
        `update organizations
            set subscription_status = 'canceled',
                cancel_at_period_end = false,
                updated_at = now()
          where id = $1
          returning id`,
        [input.orgId]
      );
      if (updated.rows.length === 0) throw new Error("Account disappeared before update.");
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: "subscription_canceled",
          orgId: input.orgId,
          orgName: org.name,
          detail: { stripe: stripeNote },
        },
        client
      );
    });
  } catch (err) {
    console.error("[admin-accounts] local cancellation record was rolled back", err);
    return {
      ok: false,
      error: org.stripe_subscription_id
        ? "Stripe cancelled the subscription, but the local account state and required audit record could not be saved. The customer will not be charged; reconcile this account before retrying another billing action."
        : "The subscription cancellation was not completed because the account state and required audit record could not be saved together. Nothing changed; try again.",
    };
  }

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

  try {
    await transaction(async (client) => {
      const updated = await client.query(
        `update organizations
            set suspended_at = case when $2 then now() else null end,
                suspended_reason = case when $2 then $3 else null end,
                suspended_by = case when $2 then $4 else null end,
                updated_at = now()
          where id = $1
          returning id`,
        [input.orgId, input.suspended, input.reason.trim() || null, input.adminEmail]
      );
      if (updated.rows.length === 0) throw new Error("Account disappeared before update.");

      if (input.suspended) {
        // Suspension and session revocation are one state change. If either
        // fails, neither is committed, so a successful response never leaves a
        // supposedly suspended account operating through an old session.
        await client.query(
          `delete from sessions
            where user_id in (select user_id from organization_members where org_id = $1)`,
          [input.orgId]
        );
      }
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: input.suspended ? "account_suspended" : "account_reactivated",
          orgId: input.orgId,
          orgName: name,
          detail: { reason: input.reason.trim() || null },
        },
        client
      );
    });
  } catch (err) {
    return rolledBackAdminMutation(
      input.suspended ? "The account suspension" : "The account reactivation",
      err
    );
  }

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
export async function purgeOrganization(
  orgId: string,
  requiredAudit?: {
    adminEmail: string;
    orgName: string;
    detail: Record<string, unknown>;
  }
): Promise<void> {
  await transaction(async (tx) => {
    /*
     * Lock the organization before discovering files. Inserts carrying this
     * org as a foreign key cannot race the snapshot and leave a newly-created
     * object behind after the account row is removed.
     */
    const locked = await tx.query<{ id: string }>(
      `select id from organizations where id = $1 for update`,
      [orgId]
    );
    if (locked.rows.length === 0) {
      if (requiredAudit) throw new Error("Account disappeared before deletion.");
      return;
    }

    const members = await tx.query<{ id: string; email: string }>(
      `select u.id, u.email
         from organization_members m
         join users u on u.id = m.user_id
        where m.org_id = $1`,
      [orgId]
    );

    /*
     * Capture physical objects while their ownership rows still exist. A null
     * backend means the table predates that metadata, so all configured
     * external locations are checked. DB bytes are deleted on this transaction
     * so a metadata rollback also restores them.
     */
    const objects = await tx.query<{ path: string; backend: string | null }>(
      `select distinct path, backend
         from (
           select d.storage_path as path, d.storage_backend as backend
             from documents d
             left join opportunities o on o.id = d.opportunity_id
            where coalesce(d.org_id, o.org_id) = $1 and d.storage_path is not null
           union all
           select d.storage_path as path, null::text as backend
             from subcontractor_documents d
             left join subcontractors s on s.id = d.subcontractor_id
            where coalesce(d.org_id, s.org_id) = $1 and d.storage_path is not null
           union all
           select storage_path as path, null::text as backend
             from compliance_item_documents
            where org_id = $1 and storage_path is not null
           union all
           select storage_path as path, null::text as backend
             from feedback_reports
            where org_id = $1 and storage_path is not null
           union all
           select path, 'db'::text as backend
             from file_blobs
            where org_id = $1
         ) owned_objects
        where path is not null`,
      [orgId]
    );

    const byPath = new Map<string, Set<StorageBackend | "unknown">>();
    for (const object of objects.rows) {
      const backend: StorageBackend | "unknown" =
        object.backend === "supabase" || object.backend === "db" || object.backend === "local"
          ? object.backend
          : "unknown";
      const backends = byPath.get(object.path) ?? new Set<StorageBackend | "unknown">();
      backends.add(backend);
      byPath.set(object.path, backends);
    }

    for (const [objectPath, backends] of byPath) {
      /*
       * Historical flat paths can be referenced by more than one tenant. In
       * that state the bytes belong to the surviving reference too, so purge
       * removes only this account's metadata and transfers a target-owned DB
       * blob to one of the surviving owners.
       */
      const otherOwners = await tx.query<{ org_id: string | null }>(
        `select distinct owner.org_id
           from (
             select coalesce(d.org_id, o.org_id) as org_id
               from documents d
               left join opportunities o on o.id = d.opportunity_id
              where d.storage_path = $2
             union all
             select coalesce(d.org_id, s.org_id) as org_id
               from subcontractor_documents d
               left join subcontractors s on s.id = d.subcontractor_id
              where d.storage_path = $2
             union all
             select org_id from compliance_item_documents where storage_path = $2
             union all
             select org_id from feedback_reports where storage_path = $2
             union all
             select org_id from file_blobs where path = $2
           ) owner
          where owner.org_id is null or owner.org_id <> $1
          order by owner.org_id nulls last`,
        [orgId, objectPath]
      );
      if (otherOwners.rows.length > 0) {
        await tx.query(
          `update file_blobs set org_id = $3 where path = $2 and org_id = $1`,
          [orgId, objectPath, otherOwners.rows[0].org_id]
        );
        continue;
      }

      try {
        if (backends.has("unknown")) {
          await storage.removeExternal(objectPath);
        } else {
          for (const backend of backends) {
            if (backend === "supabase" || backend === "local") {
              await storage.removeExternal(objectPath, backend);
            }
          }
        }
      } catch (err) {
        throw new Error(
          `Could not remove stored file ${objectPath}. ${err instanceof Error ? err.message : String(err)}`
        );
      }
      await tx.query(
        `delete from file_blobs
          where path = $2 and (org_id = $1 or org_id is null)`,
        [orgId, objectPath]
      );
    }

    // These historical child tables did not always carry org_id. Clear them
    // before the generic pass so they cannot strand their parent items.
    await tx.query(
      `delete from compliance_item_events
        where item_id in (select id from compliance_items where org_id = $1)`,
      [orgId]
    );
    await tx.query(
      `delete from compliance_item_documents
        where item_id in (select id from compliance_items where org_id = $1)`,
      [orgId]
    );

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

    /*
     * A person may belong to several organizations, so only identities left
     * with no membership are removed. Deleting the user cascades through
     * sessions, password reset tokens and login aliases. Platform operators
     * are retained even if a temporary support membership was their only one.
     */
    const orphanedMemberIds = members.rows
      .filter((member) => !isPlatformAdmin(member.email))
      .map((member) => member.id);
    if (orphanedMemberIds.length > 0) {
      await tx.query(
        `delete from users u
          where u.id = any($1::uuid[])
            and not exists (
              select 1 from organization_members m where m.user_id = u.id
            )`,
        [orphanedMemberIds]
      );
    }

    if (requiredAudit) {
      await recordRequiredAdminAction(
        {
          adminEmail: requiredAudit.adminEmail,
          action: "account_deleted",
          orgId,
          orgName: requiredAudit.orgName,
          detail: requiredAudit.detail,
        },
        tx
      );
    }
  });
}

/**
 * Delete an account and everything in it. Irreversible.
 *
 * The guards are the point of this wrapper: it refuses our own account, and it
 * requires the name typed back exactly. purgeOrganization does the work.
 */
/**
 * Schedule a deletion rather than performing one.
 *
 * The account is suspended in the same statement, which is the part the
 * administrator actually wanted immediately: use stops, billing stops being
 * collectable, and the customer cannot carry on in an account somebody has
 * decided to remove. The data is untouched, which is what makes the window
 * recoverable at all.
 */
export async function scheduleAccountDeletion(input: {
  orgId: string;
  confirmName: string;
  reason: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  let org: AdminAccountRow | null;
  let ownAccount: boolean;
  try {
    [org, ownAccount] = await Promise.all([
      adminAccountForDestructiveAction(input.orgId),
      isOwnAccount(input.orgId),
    ]);
  } catch {
    return {
      ok: false,
      error:
        "Account ownership could not be verified, so deletion was not scheduled. Try again when the database is available.",
    };
  }
  if (!org) return { ok: false, error: "That account no longer exists." };

  const { deletionBlockedReason, purgeDueAt, DELETION_GRACE_DAYS } = await import(
    "../domain/account-deletion"
  );
  const blocked = deletionBlockedReason({
    isOwnAccount: ownAccount,
    alreadyScheduled: Boolean(org.deletion_scheduled_at),
  });
  if (blocked) return { ok: false, error: blocked };

  // Typing the name is the whole safety mechanism, and it stays on the
  // scheduled path too: this still ends in the data going.
  if (input.confirmName.trim() !== org.name) {
    return {
      ok: false,
      error: `Type the account name exactly ("${org.name}") to confirm.`,
    };
  }

  const dueAt = purgeDueAt();
  try {
    await transaction(async (client) => {
      const updated = await client.query(
        `update organizations
            set deletion_scheduled_at = $2,
                deletion_requested_at = now(),
                deletion_requested_by = $3,
                deletion_reason = nullif($4, ''),
                suspended_at = coalesce(suspended_at, now()),
                suspended_reason = coalesce(suspended_reason, 'Scheduled for deletion'),
                updated_at = now()
          where id = $1
          returning id`,
        [input.orgId, dueAt.toISOString(), input.adminEmail, input.reason.trim()]
      );
      if (updated.rows.length === 0) throw new Error("Account disappeared before update.");
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: "account_deletion_scheduled",
          orgId: input.orgId,
          orgName: org.name,
          detail: {
            due_at: dueAt.toISOString(),
            grace_days: DELETION_GRACE_DAYS,
            reason: input.reason.trim() || null,
          },
        },
        client
      );
    });
  } catch (err) {
    return rolledBackAdminMutation("The account deletion schedule", err);
  }

  return {
    ok: true,
    message: `${org.name} is suspended now and will be deleted in ${DELETION_GRACE_DAYS} days. Cancel any time before then and nothing is lost.`,
  };
}

/**
 * Call off a scheduled deletion.
 *
 * The suspension is lifted with it, because it was applied by the scheduling
 * and leaving it would restore an account that still does not work. A
 * suspension applied separately, before the deletion was scheduled, is not
 * touched: it was somebody else's decision about something else.
 */
export async function cancelAccountDeletion(input: {
  orgId: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  let org: AdminAccountRow | null;
  try {
    org = await adminAccountForDestructiveAction(input.orgId);
  } catch {
    return {
      ok: false,
      error:
        "The deletion schedule could not be checked, so nothing was changed. Try again when the database is available.",
    };
  }
  if (!org) return { ok: false, error: "That account no longer exists." };
  if (!org.deletion_scheduled_at) {
    return { ok: false, error: "No deletion is scheduled for this account." };
  }

  try {
    await transaction(async (client) => {
      const updated = await client.query(
        `update organizations
            set deletion_scheduled_at = null,
                deletion_requested_at = null,
                deletion_requested_by = null,
                deletion_reason = null,
                suspended_at = case when suspended_reason = 'Scheduled for deletion'
                                    then null else suspended_at end,
                suspended_reason = case when suspended_reason = 'Scheduled for deletion'
                                        then null else suspended_reason end,
                updated_at = now()
          where id = $1
          returning id`,
        [input.orgId]
      );
      if (updated.rows.length === 0) throw new Error("Account disappeared before update.");
      await recordRequiredAdminAction(
        {
          adminEmail: input.adminEmail,
          action: "account_deletion_cancelled",
          orgId: input.orgId,
          orgName: org.name,
          detail: { was_due_at: org.deletion_scheduled_at },
        },
        client
      );
    });
  } catch (err) {
    return rolledBackAdminMutation("The deletion cancellation", err);
  }

  return { ok: true, message: `${org.name} is no longer scheduled for deletion.` };
}

/** Accounts whose grace period has run out, for the sweep to purge. */
export async function accountsDueForPurge(): Promise<{ id: string; name: string }[]> {
  return query<{ id: string; name: string }>(
    `select id, name from organizations
      where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
      order by deletion_scheduled_at asc
      limit 25`
  );
}

/**
 * Mark an account as a customer, internal, or a test fixture.
 *
 * The classification decides whether it appears in the headline counts on
 * the Accounts page. Nothing else changes: a test account still works, it is
 * just no longer counted as a customer when somebody reads "3 locked out".
 */
export async function setClassification(input: {
  orgId: string;
  classification: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  if (!["customer", "internal", "test"].includes(input.classification)) {
    return { ok: false, error: "Classification must be customer, internal or test." };
  }
  let name: string;
  try {
    const result = await transaction(async (client) => {
      const updated = await client.query<{ name: string }>(
        `update organizations set classification = $2, updated_at = now()
          where id = $1 returning name`,
        [input.orgId, input.classification]
      );
      const row = updated.rows[0];
      if (!row) return null;
      await recordRequiredAdminAction(
        {
          orgId: input.orgId,
          orgName: row.name,
          adminEmail: input.adminEmail,
          action: "set_classification",
          detail: { classification: input.classification },
        },
        client
      );
      return row.name;
    });
    if (!result) return { ok: false, error: "No such account." };
    name = result;
  } catch (err) {
    return rolledBackAdminMutation("The account classification", err);
  }
  return {
    ok: true,
    message:
      input.classification === "customer"
        ? `${name} counts as a customer again.`
        : `${name} is marked ${input.classification} and no longer counts in the customer totals.`,
  };
}

export async function deleteAccount(input: {
  orgId: string;
  confirmName: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  let org: AdminAccountRow | null;
  let ownAccount: boolean;
  try {
    [org, ownAccount] = await Promise.all([
      adminAccountForDestructiveAction(input.orgId),
      isOwnAccount(input.orgId),
    ]);
  } catch {
    return {
      ok: false,
      error:
        "Account ownership could not be verified, so nothing was deleted. Try again when the database is available.",
    };
  }
  if (!org) return { ok: false, error: "That account no longer exists." };

  if (ownAccount) {
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
    await purgeOrganization(input.orgId, {
      adminEmail: input.adminEmail,
      orgName: org.name,
      detail: { owner_email: org.owner_email, member_count: org.member_count },
    });
  } catch (err) {
    return {
      ok: false,
      error:
        `Account deletion did not complete. Some physical files may already have been removed, ` +
        `but the account records were not committed as deleted. Retry the deletion. ` +
        `${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, message: `${org.name} and all of its data are gone.` };
}

/**
 * Change one member's role on an account.
 *
 * The rule that cannot be broken here: an account must never be left without
 * an owner. An account nobody can administer is the recurring support case
 * the "No owner" filter exists to find, and this function must not be able
 * to create one.
 */
export async function setMemberRole(input: {
  orgId: string;
  userId: string;
  role: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const allowed = ["owner", "admin", "operator", "estimator", "member", "viewer"];
  if (!allowed.includes(input.role)) {
    return { ok: false, error: `Role must be one of: ${allowed.join(", ")}.` };
  }

  try {
    return await transaction(async (client): Promise<AdminActionResult> => {
      // Serializes owner changes for this account. Without this lock, two
      // concurrent demotions can both count two owners and leave none.
      const org = await client.query<{ name: string }>(
        `select name from organizations where id = $1 for update`,
        [input.orgId]
      );
      if (!org.rows[0]) return { ok: false, error: "That account no longer exists." };

      const found = await client.query<{ role: string; email: string }>(
        `select m.role, u.email from organization_members m
           join users u on u.id = m.user_id
          where m.org_id = $1 and m.user_id = $2`,
        [input.orgId, input.userId]
      );
      const current = found.rows[0];
      if (!current) return { ok: false, error: "That person is not on this account." };

      if (current.role === "owner" && input.role !== "owner") {
        const counted = await client.query<{ n: string }>(
          `select count(*) as n from organization_members where org_id = $1 and role = 'owner'`,
          [input.orgId]
        );
        if (Number(counted.rows[0]?.n ?? 0) <= 1) {
          return {
            ok: false,
            error:
              "That is the only owner. Make somebody else the owner first, or this account has nobody who can administer it.",
          };
        }
      }

      const updated = await client.query(
        `update organization_members set role = $3 where org_id = $1 and user_id = $2`,
        [input.orgId, input.userId, input.role]
      );
      if (updated.rowCount !== 1) throw new Error("Membership disappeared before update.");
      await recordRequiredAdminAction(
        {
          orgId: input.orgId,
          orgName: org.rows[0].name,
          userId: input.userId,
          adminEmail: input.adminEmail,
          action: "member_role_changed",
          detail: { email: current.email, from: current.role, to: input.role },
        },
        client
      );
      return { ok: true, message: `${current.email} is now ${input.role}.` };
    });
  } catch (err) {
    return rolledBackAdminMutation("The member role change", err);
  }
}

/**
 * Hand the account to a different member.
 *
 * One step rather than two role edits, because the two-step version has a
 * failure mode in the middle: promote the new owner, get interrupted, and
 * the account has two owners; demote first and it briefly has none, which
 * setMemberRole above rightly refuses.
 */
export async function transferOwnership(input: {
  orgId: string;
  toUserId: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  try {
    return await transaction(async (client): Promise<AdminActionResult> => {
      const org = await client.query<{ name: string }>(
        `select name from organizations where id = $1 for update`,
        [input.orgId]
      );
      if (!org.rows[0]) return { ok: false, error: "That account no longer exists." };

      const found = await client.query<{ email: string; role: string }>(
        `select u.email, m.role from organization_members m
           join users u on u.id = m.user_id
          where m.org_id = $1 and m.user_id = $2`,
        [input.orgId, input.toUserId]
      );
      const target = found.rows[0];
      if (!target) return { ok: false, error: "That person is not on this account." };
      if (target.role === "owner") {
        return { ok: false, error: `${target.email} already owns this account.` };
      }

      // The outgoing owner keeps admin: handing an account over is not the
      // same as being removed from it, and the difference matters to whoever
      // built the company the account belongs to.
      await client.query(
        `update organization_members set role = 'admin' where org_id = $1 and role = 'owner'`,
        [input.orgId]
      );
      const promoted = await client.query(
        `update organization_members set role = 'owner' where org_id = $1 and user_id = $2`,
        [input.orgId, input.toUserId]
      );
      if (promoted.rowCount !== 1) throw new Error("Target membership disappeared before update.");
      await recordRequiredAdminAction(
        {
          orgId: input.orgId,
          orgName: org.rows[0].name,
          userId: input.toUserId,
          adminEmail: input.adminEmail,
          action: "ownership_transferred",
          detail: { to: target.email },
        },
        client
      );
      return {
        ok: true,
        message: `${target.email} now owns this account. The previous owner keeps admin.`,
      };
    });
  } catch (err) {
    return rolledBackAdminMutation("The ownership transfer", err);
  }
}
