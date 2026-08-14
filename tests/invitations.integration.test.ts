/**
 * Invitations against a real database.
 *
 * The pure parts of the terms are covered in billing-concessions.test.ts. What
 * needs a database is everything about the invitation ROW: that a link works
 * exactly once even under a race, that an address which already signs in here
 * cannot be invited, and that accepting actually puts the promised terms onto
 * the new account.
 *
 * Stripe is never reached: every case here uses terms that need no coupon
 * (normal price, and a free account, which is our own exemption flag). That is
 * not a way of dodging the discount path, it is the same reason the discount
 * path exists as its own module.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("inviting somebody onto chosen terms (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let invitations: typeof import("../lib/admin/invitations");

  const tag = randomUUID().slice(0, 8);
  const ADMIN = `invite-admin-${tag}@example.test`;
  const created: { orgIds: string[]; userIds: string[]; emails: string[] } = {
    orgIds: [],
    userIds: [],
    emails: [],
  };

  /**
   * Write an invitation row directly with a token we know.
   *
   * `createInvitation` sends mail and (for a discount) talks to Stripe. The
   * redemption tests care about neither, and going through it would make them
   * depend on the platform inbox being connected.
   */
  async function seedInvitation(input: {
    email: string;
    kind?: "none" | "free_account";
    expiresInMs?: number;
    plan?: string;
    interval?: string;
    note?: string;
  }): Promise<{ id: string; token: string }> {
    const token = randomBytes(32).toString("hex");
    const row = await queryOne<{ id: string }>(
      `insert into account_invitations
         (email, invited_by_email, plan_key, billing_interval,
          concession_kind, token_hash, expires_at, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id`,
      [
        input.email,
        ADMIN,
        input.plan ?? "standard",
        input.interval ?? "month",
        input.kind ?? "none",
        createHash("sha256").update(token).digest("hex"),
        new Date(Date.now() + (input.expiresInMs ?? 7 * 24 * 3600 * 1000)).toISOString(),
        input.note ?? null,
      ]
    );
    created.emails.push(input.email);
    return { id: row!.id, token };
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    invitations = await import("../lib/admin/invitations");
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const orgId of created.orgIds) {
      await query(`delete from organizations where id = $1`, [orgId]).catch(() => {});
    }
    for (const userId of created.userIds) {
      await query(`delete from users where id = $1`, [userId]).catch(() => {});
    }
    for (const email of created.emails) {
      await query(`delete from account_invitations where email = $1`, [email]).catch(() => {});
      await query(`delete from users where email = $1`, [email]).catch(() => {});
    }
    await query(`delete from admin_actions where admin_email = $1`, [ADMIN]).catch(() => {});
  });

  function track(result: { userId: string; orgId: string }) {
    created.userIds.push(result.userId);
    created.orgIds.push(result.orgId);
  }

  it("shows the offer before anything is claimed, and claims nothing by showing it", async () => {
    const email = `look-${tag}@example.test`;
    const { token } = await seedInvitation({ email, note: "Met at the conference." });

    const first = await invitations.invitationForToken(token);
    expect(first?.email).toBe(email);
    expect(first?.note).toBe("Met at the conference.");

    // Reading it twice must still work. If displaying the page consumed the
    // invitation, a refresh would break it.
    const second = await invitations.invitationForToken(token);
    expect(second?.email).toBe(email);
  });

  it("refuses a token that does not exist without saying which part was wrong", async () => {
    expect(await invitations.invitationForToken(randomBytes(32).toString("hex"))).toBeNull();
    expect(await invitations.invitationForToken("")).toBeNull();
  });

  it("creates the account and signs the person in", async () => {
    const email = `accept-${tag}@example.test`;
    const { id, token } = await seedInvitation({ email });

    const result = await invitations.redeemInvitation({
      token,
      name: "Dana Reyes",
      companyName: `Reyes Builders ${tag}`,
      password: "a-long-enough-password",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    track(result);

    expect(result.sessionToken).toBeTruthy();

    const row = await queryOne<{ accepted_at: string | null; accepted_org_id: string | null }>(
      `select accepted_at::text as accepted_at, accepted_org_id
         from account_invitations where id = $1`,
      [id]
    );
    expect(row?.accepted_at).toBeTruthy();
    expect(row?.accepted_org_id).toBe(result.orgId);
  });

  it("works exactly once, even when two requests arrive together", async () => {
    // The reason the invitation is claimed with a conditional update before
    // the account is created. Without it both callers get past the check and
    // one of them fails deep inside signup, after side effects.
    const email = `race-${tag}@example.test`;
    const { token } = await seedInvitation({ email });

    const attempts = await Promise.all([
      invitations.redeemInvitation({
        token,
        name: "First Caller",
        companyName: `Race Co A ${tag}`,
        password: "a-long-enough-password",
      }),
      invitations.redeemInvitation({
        token,
        name: "Second Caller",
        companyName: `Race Co B ${tag}`,
        password: "a-long-enough-password",
      }),
    ]);

    const winners = attempts.filter((a) => !("error" in a));
    const losers = attempts.filter((a) => "error" in a);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    for (const w of winners) track(w as { userId: string; orgId: string });

    // The loser is told something true and actionable, not a database error.
    expect((losers[0] as { error: string }).error).toMatch(/already been used/i);

    // And only one account exists for that address.
    const users = await query<{ id: string }>(`select id from users where email = $1`, [email]);
    expect(users).toHaveLength(1);
  });

  it("puts a free account on our own exemption flag, not on a discount", async () => {
    const email = `free-${tag}@example.test`;
    const { token } = await seedInvitation({ email, kind: "free_account", plan: "founding" });

    const result = await invitations.redeemInvitation({
      token,
      name: "Free Rider",
      companyName: `Comped Co ${tag}`,
      password: "a-long-enough-password",
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    track(result);

    const org = await queryOne<{
      billing_exempt: boolean;
      billing_exempt_reason: string | null;
      plan_key: string | null;
      pending_concession_code: string | null;
    }>(
      `select billing_exempt, billing_exempt_reason, plan_key, pending_concession_code
         from organizations where id = $1`,
      [result.orgId]
    );
    expect(org?.billing_exempt).toBe(true);
    expect(org?.billing_exempt_reason).toContain(ADMIN);
    expect(org?.plan_key).toBe("founding");
    // A free account has no coupon waiting for it. One left here would be
    // applied at a checkout this account should never reach.
    expect(org?.pending_concession_code).toBeNull();

    const { accessLevel } = await import("../lib/billing/entitlements");
    expect(
      accessLevel({
        subscription_status: org ? "none" : null,
        trial_ends_at: null,
        billing_exempt: true,
        suspended_at: null,
      })
    ).toBe("full");
  });

  it("refuses an expired link, and says so rather than failing quietly", async () => {
    const email = `expired-${tag}@example.test`;
    const { token } = await seedInvitation({ email, expiresInMs: -1000 });

    expect(await invitations.invitationForToken(token)).toBeNull();
    const result = await invitations.redeemInvitation({
      token,
      name: "Too Late",
      companyName: `Late Co ${tag}`,
      password: "a-long-enough-password",
    });
    expect("error" in result && result.error).toMatch(/expired/i);
  });

  it("refuses a withdrawn link", async () => {
    const email = `revoked-${tag}@example.test`;
    const { id, token } = await seedInvitation({ email });
    const revoke = await invitations.revokeInvitation({ id, adminEmail: ADMIN });
    expect(revoke.ok).toBe(true);

    const result = await invitations.redeemInvitation({
      token,
      name: "Withdrawn",
      companyName: `Gone Co ${tag}`,
      password: "a-long-enough-password",
    });
    expect("error" in result && result.error).toMatch(/withdrawn/i);
  });

  it("does not burn the link on a password that is too short", async () => {
    // Rejecting bad input must happen before the claim. Otherwise a typo
    // costs somebody their only invitation.
    const email = `shortpw-${tag}@example.test`;
    const { token } = await seedInvitation({ email });

    const bad = await invitations.redeemInvitation({
      token,
      name: "Typo",
      companyName: `Typo Co ${tag}`,
      password: "short",
    });
    expect("error" in bad).toBe(true);

    const good = await invitations.redeemInvitation({
      token,
      name: "Second Try",
      companyName: `Typo Co ${tag}`,
      password: "a-long-enough-password",
    });
    expect("error" in good).toBe(false);
    if (!("error" in good)) track(good);
  });

  it("will not invite an address that already signs in here", async () => {
    const email = `existing-${tag}@example.test`;
    const { token } = await seedInvitation({ email });
    const made = await invitations.redeemInvitation({
      token,
      name: "Already Here",
      companyName: `Existing Co ${tag}`,
      password: "a-long-enough-password",
    });
    if ("error" in made) throw new Error(made.error);
    track(made);

    const again = await invitations.createInvitation({
      email,
      plan: "standard",
      interval: "month",
      concession: { kind: "none" },
      adminEmail: ADMIN,
    });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toMatch(/already signs in/i);
  });

  it("will not leave two live invitations for the same address", async () => {
    // Two working links to the same person means the second one to be redeemed
    // hits the email uniqueness rule and reads as a system error to somebody
    // who did nothing wrong.
    const email = `dupe-${tag}@example.test`;
    await seedInvitation({ email });

    const second = await invitations.createInvitation({
      email,
      plan: "standard",
      interval: "month",
      concession: { kind: "none" },
      adminEmail: ADMIN,
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toMatch(/already has an invitation/i);
  });

  it("will not withdraw an invitation that was accepted a moment ago", async () => {
    // Revoke used to read the row and then update unconditionally. If somebody
    // accepted in between, that wrote revoked_at onto a live customer and, for
    // a discounted invitation, switched off their promotion code at Stripe.
    const email = `revoke-race-${tag}@example.test`;
    const { id, token } = await seedInvitation({ email });

    const [accepted, revoked] = await Promise.all([
      invitations.redeemInvitation({
        token,
        name: "Just In Time",
        companyName: `Race Revoke Co ${tag}`,
        password: "a-long-enough-password",
      }),
      // Give the redemption a head start so it holds the claim, which is the
      // ordering that used to corrupt state.
      new Promise((r) => setTimeout(r, 50)).then(() =>
        invitations.revokeInvitation({ id, adminEmail: ADMIN })
      ),
    ]);

    expect("error" in accepted).toBe(false);
    if (!("error" in accepted)) track(accepted);
    expect(revoked.ok).toBe(false);

    const row = await queryOne<{ revoked_at: string | null }>(
      `select revoked_at::text as revoked_at from account_invitations where id = $1`,
      [id]
    );
    expect(row?.revoked_at).toBeNull();
  });

  it("will not send a new link for an invitation that has been withdrawn", async () => {
    const email = `resend-dead-${tag}@example.test`;
    const { id } = await seedInvitation({ email });
    await invitations.revokeInvitation({ id, adminEmail: ADMIN });

    const again = await invitations.resendInvitation({ id, adminEmail: ADMIN });
    expect(again.ok).toBe(false);
  });

  it("records that the terms actually landed, so a half-done acceptance is visible", async () => {
    const email = `applied-${tag}@example.test`;
    const { id, token } = await seedInvitation({ email, kind: "free_account" });
    const result = await invitations.redeemInvitation({
      token,
      name: "Terms Landed",
      companyName: `Applied Co ${tag}`,
      password: "a-long-enough-password",
    });
    if ("error" in result) throw new Error(result.error);
    track(result);

    const row = await queryOne<{ terms_applied_at: string | null }>(
      `select terms_applied_at::text as terms_applied_at
         from account_invitations where id = $1`,
      [id]
    );
    expect(row?.terms_applied_at).toBeTruthy();
  });

  it("binds checkout to the plan the person was invited on", async () => {
    // Checkout otherwise reads the plan from the query string and filters it
    // through the public founding window. An invitation is a private
    // arrangement, so neither applies: a founding invitation accepted after
    // the public window closed must still be founding.
    const email = `bound-${tag}@example.test`;
    const { token } = await seedInvitation({
      email,
      plan: "founding",
      interval: "year",
    });
    const result = await invitations.redeemInvitation({
      token,
      name: "Bound Terms",
      companyName: `Bound Co ${tag}`,
      password: "a-long-enough-password",
    });
    if ("error" in result) throw new Error(result.error);
    track(result);

    expect(await invitations.invitedTermsForOrg(result.orgId)).toEqual({
      plan: "founding",
      interval: "year",
    });
  });

  it("never leaves a private promo code visible to checkout without the terms that go with it", async () => {
    // The invariant behind putting the terms write and its stamp in one
    // transaction. If a half-applied acceptance were possible, an
    // organization could hold a pending promotion code while
    // invitedTermsForOrg returned null, and checkout would then apply that
    // private discount to whatever plan the query string asked for. Here the
    // broken state is forced by hand to prove the read side refuses it.
    const email = `unstamped-${tag}@example.test`;
    const { id, token } = await seedInvitation({ email, plan: "founding" });
    const result = await invitations.redeemInvitation({
      token,
      name: "Half Applied",
      companyName: `Unstamped Co ${tag}`,
      password: "a-long-enough-password",
    });
    if ("error" in result) throw new Error(result.error);
    track(result);

    await query(`update account_invitations set terms_applied_at = null where id = $1`, [id]);
    expect(await invitations.invitedTermsForOrg(result.orgId)).toBeNull();
  });

  it("stops binding checkout for an account that never came in by invitation", async () => {
    const stranger = randomUUID();
    expect(await invitations.invitedTermsForOrg(stranger)).toBeNull();
  });

  it("reports state from the row rather than from whoever is asking", async () => {
    const soon = new Date(Date.now() + 1000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    const s = invitations.invitationState;
    expect(s({ accepted_at: null, revoked_at: null, expires_at: soon })).toBe("outstanding");
    expect(s({ accepted_at: past, revoked_at: null, expires_at: soon })).toBe("accepted");
    expect(s({ accepted_at: null, revoked_at: past, expires_at: soon })).toBe("revoked");
    expect(s({ accepted_at: null, revoked_at: null, expires_at: past })).toBe("expired");
    // Accepted outranks expired: somebody who got in before the deadline is in.
    expect(s({ accepted_at: past, revoked_at: null, expires_at: past })).toBe("accepted");
  });
});
