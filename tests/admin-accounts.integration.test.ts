/**
 * Cross-tenant account administration.
 *
 * Builds a throwaway organization with its own owner and removes both
 * afterwards, so it is safe against the dev database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("administering somebody else's account (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let accounts: typeof import("../lib/admin/accounts");
  let hashPassword: typeof import("../lib/auth").hashPassword;
  let accessLevel: typeof import("../lib/billing/entitlements").accessLevel;

  const tag = randomUUID().slice(0, 8);
  const ADMIN = `admin-actions-${tag}@example.test`;
  const OWNER = `owner-actions-${tag}@example.test`;
  const ORG_NAME = `Admin Test Org ${tag}`;
  let orgId = "";
  let ownerId = "";

  async function orgRow() {
    return queryOne<{
      subscription_status: string | null;
      trial_ends_at: string | null;
      billing_exempt: boolean;
      billing_exempt_reason: string | null;
      suspended_at: string | null;
      suspended_reason: string | null;
    }>(
      `select subscription_status,
              trial_ends_at::text as trial_ends_at,
              billing_exempt,
              billing_exempt_reason,
              suspended_at::text  as suspended_at,
              suspended_reason
         from organizations where id = $1`,
      [orgId]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    accounts = await import("../lib/admin/accounts");
    ({ hashPassword } = await import("../lib/auth"));
    ({ accessLevel } = await import("../lib/billing/entitlements"));

    const user = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role)
       values ($1, $2, 'Owner Actions', 'operator') returning id`,
      [OWNER, hashPassword("correct horse battery staple")]
    );
    ownerId = user!.id;

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'none') returning id`,
      [ORG_NAME]
    );
    orgId = org!.id;

    await query(
      `insert into organization_members (org_id, user_id, role) values ($1, $2, 'owner')`,
      [orgId, ownerId]
    );
  });

  afterAll(async () => {
    if (!hasDb) return;
    await query(`delete from admin_audit_log where target_org_id = $1`, [orgId]).catch(() => {});
    await query(`delete from organization_members where org_id = $1`, [orgId]).catch(() => {});
    await query(`delete from organizations where id = $1`, [orgId]).catch(() => {});
    await query(`delete from users where id = $1`, [ownerId]).catch(() => {});
  });

  beforeEach(async () => {
    await query(
      `update organizations
          set billing_exempt = false, billing_exempt_reason = null,
              suspended_at = null, suspended_reason = null,
              subscription_status = 'none', trial_ends_at = null
        where id = $1`,
      [orgId]
    );
  });

  it("shows the account in the cross-tenant list with its owner attached", async () => {
    const rows = await accounts.adminAccountRows();
    const mine = rows.find((r) => r.id === orgId);
    expect(mine?.owner_email).toBe(OWNER);
    expect(mine?.member_count).toBe(1);
    // Access is computed, not stored: no subscription and no trial means out.
    expect(mine?.access).toBe("none");
  });

  describe("comping", () => {
    it("turns a locked-out account into a working one", async () => {
      const before = await orgRow();
      expect(accessLevel(before!)).toBe("none");

      const res = await accounts.setBillingExempt({
        orgId,
        exempt: true,
        reason: "Design partner",
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(true);

      const after = await orgRow();
      expect(after!.billing_exempt).toBe(true);
      expect(after!.billing_exempt_reason).toBe("Design partner");
      // Stripe still says nothing was ever paid, and that is now irrelevant.
      expect(after!.subscription_status).toBe("none");
      expect(accessLevel(after!)).toBe("full");
    });

    /**
     * A comp with no reason becomes unexplainable the moment the person who
     * granted it forgets, and then nobody is willing to revoke it.
     */
    it("refuses to comp an account without saying why", async () => {
      const res = await accounts.setBillingExempt({
        orgId,
        exempt: true,
        reason: "   ",
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(false);
      expect((await orgRow())!.billing_exempt).toBe(false);
    });

    it("clears the reason when the comp is taken away", async () => {
      await accounts.setBillingExempt({ orgId, exempt: true, reason: "x", adminEmail: ADMIN });
      await accounts.setBillingExempt({ orgId, exempt: false, reason: "", adminEmail: ADMIN });
      const after = await orgRow();
      expect(after!.billing_exempt).toBe(false);
      expect(after!.billing_exempt_reason).toBeNull();
      expect(accessLevel(after!)).toBe("none");
    });
  });

  describe("trials", () => {
    /**
     * Extending a trial that already lapsed has to count from today. Adding
     * days to a date in the past looks like it worked and changes nothing.
     */
    it("extends a lapsed trial from today, not from the old end date", async () => {
      await query(
        `update organizations
            set subscription_status = 'trial', trial_ends_at = now() - interval '30 days'
          where id = $1`,
        [orgId]
      );

      const res = await accounts.extendTrial({ orgId, days: 10, adminEmail: ADMIN });
      expect(res.ok).toBe(true);

      const after = await orgRow();
      const daysOut =
        (new Date(after!.trial_ends_at!).getTime() - Date.now()) / 86_400_000;
      expect(daysOut).toBeGreaterThan(9);
      expect(daysOut).toBeLessThan(11);
      expect(accessLevel(after!)).toBe("trial");
    });

    it("adds to a live trial rather than shortening it", async () => {
      await query(
        `update organizations
            set subscription_status = 'trial', trial_ends_at = now() + interval '5 days'
          where id = $1`,
        [orgId]
      );
      await accounts.extendTrial({ orgId, days: 10, adminEmail: ADMIN });
      const after = await orgRow();
      const daysOut =
        (new Date(after!.trial_ends_at!).getTime() - Date.now()) / 86_400_000;
      expect(daysOut).toBeGreaterThan(14);
    });

    it("refuses a nonsense length instead of writing it", async () => {
      expect((await accounts.extendTrial({ orgId, days: 0, adminEmail: ADMIN })).ok).toBe(false);
      expect((await accounts.extendTrial({ orgId, days: -5, adminEmail: ADMIN })).ok).toBe(false);
      expect((await accounts.extendTrial({ orgId, days: 9999, adminEmail: ADMIN })).ok).toBe(
        false
      );
      expect((await orgRow())!.trial_ends_at).toBeNull();
    });

    it("starts a fresh trial from today", async () => {
      const res = await accounts.restartTrial({ orgId, adminEmail: ADMIN });
      expect(res.ok).toBe(true);
      const after = await orgRow();
      expect(after!.subscription_status).toBe("trial");
      expect(accessLevel(after!)).toBe("trial");
    });
  });

  describe("suspension", () => {
    it("locks the account out and says so", async () => {
      const res = await accounts.setSuspended({
        orgId,
        suspended: true,
        reason: "Chargeback",
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(true);

      const after = await orgRow();
      expect(after!.suspended_at).not.toBeNull();
      expect(after!.suspended_reason).toBe("Chargeback");
      expect(accessLevel(after!)).toBe("none");
    });

    /**
     * Suspension has to beat the comp. Otherwise an exemption granted months
     * earlier silently undoes a deliberate decision made today.
     */
    it("beats a billing exemption", async () => {
      await accounts.setBillingExempt({ orgId, exempt: true, reason: "x", adminEmail: ADMIN });
      await accounts.setSuspended({
        orgId,
        suspended: true,
        reason: "Abuse",
        adminEmail: ADMIN,
      });
      const after = await orgRow();
      expect(after!.billing_exempt).toBe(true);
      expect(accessLevel(after!)).toBe("none");
    });

    it("signs the account's live sessions out rather than waiting for a reload", async () => {
      const token = `test-session-${randomUUID()}`;
      await query(
        `insert into sessions (id, user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
        [token, ownerId]
      );
      await accounts.setSuspended({
        orgId,
        suspended: true,
        reason: "Abuse",
        adminEmail: ADMIN,
      });
      const still = await queryOne(`select id from sessions where id = $1`, [token]);
      expect(still).toBeNull();
    });

    it("refuses to suspend without a reason", async () => {
      const res = await accounts.setSuspended({
        orgId,
        suspended: true,
        reason: "",
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(false);
      expect((await orgRow())!.suspended_at).toBeNull();
    });

    it("gives the account straight back on reinstatement", async () => {
      await query(`update organizations set subscription_status = 'active' where id = $1`, [
        orgId,
      ]);
      await accounts.setSuspended({ orgId, suspended: true, reason: "x", adminEmail: ADMIN });
      await accounts.setSuspended({ orgId, suspended: false, reason: "", adminEmail: ADMIN });
      const after = await orgRow();
      expect(after!.suspended_at).toBeNull();
      expect(after!.suspended_reason).toBeNull();
      expect(accessLevel(after!)).toBe("full");
    });
  });

  /**
   * The background agents have to agree with the gates about who is a live
   * customer. When they disagreed, our own comped organization passed every
   * check in the UI and was silently skipped by scheduled opportunity
   * ingestion, which presents as "the product stopped finding anything"
   * rather than as an access problem.
   */
  describe("which accounts the background agents keep working for", () => {
    let listActiveOrganizations: typeof import("../lib/organizations").listActiveOrganizations;

    beforeAll(async () => {
      ({ listActiveOrganizations } = await import("../lib/organizations"));
    });

    const included = async () => (await listActiveOrganizations()).some((o) => o.id === orgId);

    it("includes a comped account that has never paid", async () => {
      expect(await included()).toBe(false);
      await accounts.setBillingExempt({ orgId, exempt: true, reason: "Ours", adminEmail: ADMIN });
      expect(await included()).toBe(true);
    });

    it("drops a suspended account even while it is comped", async () => {
      await accounts.setBillingExempt({ orgId, exempt: true, reason: "Ours", adminEmail: ADMIN });
      await query(`update organizations set suspended_at = now() where id = $1`, [orgId]);
      expect(await included()).toBe(false);
    });

    it("includes a live cardless trial and drops a lapsed one", async () => {
      await query(
        `update organizations set subscription_status = 'trial',
                trial_ends_at = now() + interval '3 days' where id = $1`,
        [orgId]
      );
      expect(await included()).toBe(true);

      await query(`update organizations set trial_ends_at = now() - interval '1 day' where id = $1`, [
        orgId,
      ]);
      expect(await included()).toBe(false);
    });

    it("still includes an ordinary paying customer", async () => {
      await query(`update organizations set subscription_status = 'active' where id = $1`, [orgId]);
      expect(await included()).toBe(true);
    });
  });

  /**
   * These tools administer everybody, including us. Pointing them at our own
   * account is how the owner gets locked out again, except this time with no
   * admin UI left to undo it.
   */
  describe("our own account is protected from these tools", () => {
    const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS;

    beforeEach(() => {
      process.env.PLATFORM_ADMIN_EMAILS = OWNER;
    });

    afterAll(() => {
      if (ORIGINAL === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
      else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL;
    });

    it("refuses to take our own comp away", async () => {
      await accounts.setBillingExempt({ orgId, exempt: true, reason: "Ours", adminEmail: ADMIN });
      const res = await accounts.setBillingExempt({
        orgId,
        exempt: false,
        reason: "",
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(false);
      expect((await orgRow())!.billing_exempt).toBe(true);
    });

    it("refuses to suspend us", async () => {
      const res = await accounts.setSuspended({
        orgId,
        suspended: true,
        reason: "Oops",
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(false);
      expect((await orgRow())!.suspended_at).toBeNull();
    });

    it("refuses to delete us, even with the name typed correctly", async () => {
      const res = await accounts.deleteAccount({
        orgId,
        confirmName: ORG_NAME,
        adminEmail: ADMIN,
      });
      expect(res.ok).toBe(false);
      expect(await accounts.adminAccount(orgId)).not.toBeNull();
    });

    /**
     * Protection follows ownership, not membership. An administrator added to
     * a customer's organization to help with something must not accidentally
     * make that customer permanently unsuspendable.
     */
    it("does not protect a customer just because an admin is a member of it", async () => {
      process.env.PLATFORM_ADMIN_EMAILS = ADMIN;
      const helperId = (
        await queryOne<{ id: string }>(
          `insert into users (email, password_hash, role) values ($1, 'x', 'operator')
           returning id`,
          [ADMIN]
        )
      )!.id;
      await query(
        `insert into organization_members (org_id, user_id, role) values ($1, $2, 'member')`,
        [orgId, helperId]
      );

      try {
        const res = await accounts.setSuspended({
          orgId,
          suspended: true,
          reason: "Nonpayment",
          adminEmail: ADMIN,
        });
        expect(res.ok).toBe(true);
        expect((await orgRow())!.suspended_at).not.toBeNull();
      } finally {
        await query(`delete from organization_members where user_id = $1`, [helperId]);
        await query(`delete from users where id = $1`, [helperId]);
      }
    });

    it("still allows the harmless direction: comping and extending", async () => {
      expect(
        (await accounts.setBillingExempt({ orgId, exempt: true, reason: "Ours", adminEmail: ADMIN }))
          .ok
      ).toBe(true);
      expect((await accounts.extendTrial({ orgId, days: 30, adminEmail: ADMIN })).ok).toBe(true);
    });
  });

  describe("the audit trail", () => {
    it("records who did what, with the reason they gave", async () => {
      await accounts.setBillingExempt({
        orgId,
        exempt: true,
        reason: "Founding customer",
        adminEmail: ADMIN,
      });
      const { adminActionsForOrg } = await import("../lib/admin/audit");
      const entries = await adminActionsForOrg(orgId);
      const entry = entries.find((e) => e.action === "billing_exempt_granted");
      expect(entry?.admin_email).toBe(ADMIN);
      expect(entry?.detail?.reason).toBe("Founding customer");
      expect(entry?.target_org_name).toBe(ORG_NAME);
    });
  });

  describe("deletion", () => {
    /**
     * Typing the name is the whole safety mechanism. A yes/no confirm is one
     * misclick away from an unrecoverable mistake.
     */
    /**
     * Surrounding whitespace is forgiven because copying a name out of the
     * page above almost always brings some with it. Nothing else is: the case
     * has to match, and a blank or approximate answer does not count.
     */
    it("refuses unless the account name is typed back exactly", async () => {
      for (const wrong of ["", "  ", ORG_NAME.toLowerCase(), `${ORG_NAME}x`]) {
        const res = await accounts.deleteAccount({
          orgId,
          confirmName: wrong,
          adminEmail: ADMIN,
        });
        expect(res.ok, `"${wrong}" should not confirm`).toBe(false);
      }
      expect(await accounts.adminAccount(orgId)).not.toBeNull();
    });
  });
});

/**
 * Deletion, on an organization created solely to be deleted, with data in it.
 * Separate from the suite above so a failure here cannot leave that suite's
 * fixtures half-removed.
 */
d("deleting an account for good (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let accounts: typeof import("../lib/admin/accounts");
  let hashPassword: typeof import("../lib/auth").hashPassword;

  const tag = randomUUID().slice(0, 8);
  const ORG_NAME = `Doomed Org ${tag}`;
  const OWNER = `doomed-${tag}@example.test`;
  let orgId = "";
  let ownerId = "";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    accounts = await import("../lib/admin/accounts");
    ({ hashPassword } = await import("../lib/auth"));

    const user = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, role) values ($1, $2, 'operator') returning id`,
      [OWNER, hashPassword("correct horse battery staple")]
    );
    ownerId = user!.id;

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'trial') returning id`,
      [ORG_NAME]
    );
    orgId = org!.id;

    await query(
      `insert into organization_members (org_id, user_id, role) values ($1, $2, 'owner')`,
      [orgId, ownerId]
    );
    // Real tenant data, so the pass-based delete has foreign keys to work
    // around rather than a set of empty tables.
    await query(
      `insert into subcontractors (org_id, company_name) values ($1, 'Doomed Sub')`,
      [orgId]
    );
    await query(`insert into opportunities (org_id, title, source) values ($1, $2, 'manual')`, [
      orgId,
      "Doomed Opportunity",
    ]);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await query(`delete from admin_audit_log where target_org_id = $1`, [orgId]).catch(() => {});
    await query(`delete from users where id = $1`, [ownerId]).catch(() => {});
  });

  it("removes the organization and everything inside it", async () => {
    const res = await accounts.deleteAccount({
      orgId,
      confirmName: ORG_NAME,
      adminEmail: "admin@example.test",
    });
    expect(res.ok, res.ok ? "" : (res as { error: string }).error).toBe(true);

    expect(await accounts.adminAccount(orgId)).toBeNull();
    const subs = await query(`select id from subcontractors where org_id = $1`, [orgId]);
    const opps = await query(`select id from opportunities where org_id = $1`, [orgId]);
    expect(subs).toHaveLength(0);
    expect(opps).toHaveLength(0);
  });

  /**
   * The record has to outlive the thing it describes. A deleted account is
   * exactly the case where "who deleted this, and when" matters most, so the
   * audit row deliberately has no foreign key to follow it into the grave.
   */
  it("keeps the audit record after the account is gone", async () => {
    const entry = await queryOne<{ admin_email: string; target_org_name: string }>(
      `select admin_email, target_org_name from admin_audit_log
        where target_org_id = $1 and action = 'account_deleted'`,
      [orgId]
    );
    expect(entry?.target_org_name).toBe(ORG_NAME);
    expect(entry?.admin_email).toBe("admin@example.test");
  });
});
