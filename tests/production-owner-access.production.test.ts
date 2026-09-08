import { beforeAll, describe, expect, it } from "vitest";

/**
 * The owner account this whole task exists for. Pinned so a future migration
 * or a hand-edit in production cannot quietly take his access away again.
 *
 * This is an assertion about real production data, so it only runs against the
 * production database. The development database is deliberately a separate,
 * empty one: the worker bootstraps the owner's login there from secrets, but
 * his aliases are production history and were never copied across, so running
 * this against development would only ever test the fixture.
 */
const onProductionData =
  Boolean(process.env.DATABASE_URL) &&
  process.env.RUN_PRODUCTION_READONLY_CHECKS === "1" &&
  !["1", "true", "yes", "on"].includes((process.env.USE_REPLIT_DEV_DB ?? "").toLowerCase());
const dProd = onProductionData ? describe : describe.skip;

dProd("the platform owner's own account (integration)", () => {
  let queryOne: typeof import("../lib/db").queryOne;
  let accessLevel: typeof import("../lib/billing/entitlements").accessLevel;

  const OWNER = "brostcoholdings@gmail.com";

  beforeAll(async () => {
    ({ queryOne } = await import("../lib/db"));
    ({ accessLevel } = await import("../lib/billing/entitlements"));
  });

  it("can sign in at both brostco.com addresses", async () => {
    const account = await queryOne<{ id: string }>(
      `select id from users where lower(email) = $1`,
      [OWNER]
    );
    expect(account, "The production owner account must exist.").not.toBeNull();

    for (const alias of ["info@brostco.com", "hello@brostco.com"]) {
      const row = await queryOne<{ user_id: string }>(
        `select user_id from user_email_aliases where lower(email) = $1`,
        [alias]
      );
      expect(row?.user_id, `${alias} should reach the owner account`).toBe(account!.id);
    }
  });

  /**
   * The original bug: his organization reads 'canceled' in Stripe, because it
   * has never paid itself, and that locked him out of his own product.
   */
  it("has full access despite never having paid for a subscription", async () => {
    const org = await queryOne<{
      subscription_status: string | null;
      trial_ends_at: string | null;
      billing_exempt: boolean;
      suspended_at: string | null;
    }>(
      `select o.subscription_status,
              o.trial_ends_at::text as trial_ends_at,
              o.billing_exempt,
              o.suspended_at::text  as suspended_at
         from organizations o
         join organization_members m on m.org_id = o.id
         join users u on u.id = m.user_id
        where lower(u.email) = $1 and m.role = 'owner'
        limit 1`,
      [OWNER]
    );
    expect(org, "The production owner must have an owner membership.").not.toBeNull();

    expect(org!.billing_exempt).toBe(true);
    expect(accessLevel(org)).toBe("full");
  });

  it("no longer has the retired admin@brostco.dev account hanging around", async () => {
    const stale = await queryOne<{ id: string }>(
      `select id from users where lower(email) = 'admin@brostco.dev'`
    );
    expect(stale).toBeNull();
  });
});
