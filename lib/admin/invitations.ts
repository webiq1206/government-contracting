/**
 * Inviting a specific person onto the platform on specific terms.
 *
 * Until now the only way in was public self-signup, which hands everyone the
 * same deal. This is the other door: an address, a plan, and one of the four
 * concessions, all decided before the person has an account.
 *
 * THE TOKEN
 *
 * Same pattern as password reset, for the same reason: only a hash is stored,
 * so a leaked backup of this table is a list of who was invited rather than a
 * set of working links into the product.
 *
 * WHERE IT DIFFERS FROM PASSWORD RESET
 *
 * Redemption creates an account, which is not idempotent. Two requests
 * arriving together with the same link cannot both be allowed to proceed and
 * discover the problem later at the email uniqueness constraint, because by
 * then one of them has already made a user, an organization and a Stripe
 * coupon redemption. So the invitation is CLAIMED first, in a single
 * conditional update that only one of them can win, and released again if the
 * account creation that follows fails. A password reset needs none of this: it
 * is a write to an existing row and the loser of the race changes nothing.
 */
import { createHash, randomBytes } from "node:crypto";
import { query, queryOne } from "../db";
import { config } from "../config";
import { systemMail } from "../integrations/system-mail";
import { recordAdminAction } from "./audit";
import { reserveConcessionCode } from "./concessions";
import {
  createConcessionCode,
  deleteConcessionCoupon,
  describeConcession,
  needsStripeCode,
  validateConcession,
  type Concession,
  type ConcessionKind,
} from "../billing/concessions";
import type { AdminActionResult } from "./accounts";

/** How long an invitation stays good for. */
export const INVITATION_DAYS = 14;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface InvitationRow {
  id: string;
  email: string;
  invited_by_email: string;
  plan_key: string;
  billing_interval: string;
  concession_kind: ConcessionKind;
  concession_percent: number | null;
  concession_months: number | null;
  concession_code: string | null;
  stripe_coupon_id: string | null;
  note: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_org_id: string | null;
  /**
   * Null on an accepted invitation means the account was created but the
   * promised terms never landed. See migration 048.
   */
  terms_applied_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  sent_count: number;
  last_sent_at: string;
  created_at: string;
}

export type InvitationState = "outstanding" | "accepted" | "revoked" | "expired";

/** What state an invitation is in, decided in one place so the list and the redeem path agree. */
export function invitationState(
  row: Pick<InvitationRow, "accepted_at" | "revoked_at" | "expires_at">,
  now: Date = new Date()
): InvitationState {
  if (row.accepted_at) return "accepted";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "outstanding";
}

const INVITATION_SELECT = `
  select id, email, invited_by_email, plan_key, billing_interval,
         concession_kind, concession_percent, concession_months,
         concession_code, stripe_coupon_id, note,
         expires_at::text  as expires_at,
         accepted_at::text as accepted_at,
         accepted_org_id,
         terms_applied_at::text as terms_applied_at,
         revoked_at::text  as revoked_at,
         revoked_by, sent_count,
         last_sent_at::text as last_sent_at,
         created_at::text   as created_at
    from account_invitations`;

export async function listInvitations(limit = 100): Promise<InvitationRow[]> {
  return query<InvitationRow>(
    `${INVITATION_SELECT} order by created_at desc limit $1`,
    [limit]
  ).catch(() => []);
}

/* -------------------------------------------------------------------------
 * Creating
 * ---------------------------------------------------------------------- */

/**
 * Invite somebody.
 *
 * Refuses an address that already signs in here, checking aliases as well as
 * accounts. The platform's rule is that an address belongs to exactly one
 * person; inviting one that is taken would either fail at a database trigger
 * with a constraint error, or, worse, succeed in creating a second account for
 * somebody who already has one and cannot work out which is which.
 */
export async function createInvitation(input: {
  email: string;
  plan: "founding" | "standard";
  interval: "month" | "year";
  concession: Concession;
  note?: string | null;
  adminEmail: string;
  adminUserId?: string | null;
}): Promise<AdminActionResult & { invitationId?: string }> {
  const email = input.email.toLowerCase().trim();
  if (!email.includes("@") || email.length < 5) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const problem = validateConcession(input.concession);
  if (problem) return { ok: false, error: problem };

  const { emailTaken } = await import("../auth-signup");
  if (await emailTaken(email)) {
    return {
      ok: false,
      error: `${email} already signs in here, either as an account or as an alternate address on one. Change that account's terms from its own admin page instead of inviting them again.`,
    };
  }

  const outstanding = await queryOne<{ id: string }>(
    `select id from account_invitations
      where lower(email) = $1 and accepted_at is null and revoked_at is null`,
    [email]
  ).catch(() => null);
  if (outstanding) {
    return {
      ok: false,
      error: `${email} already has an invitation waiting. Re-send or revoke that one rather than issuing a second link.`,
    };
  }

  // The coupon comes first. If Stripe will not create it there is no
  // invitation worth storing, and creating the row first would leave an
  // invitation promising a discount that does not exist.
  let code: string | null = null;
  let couponId: string | null = null;
  if (needsStripeCode(input.concession.kind)) {
    code = await reserveConcessionCode();
    if (!code) return { ok: false, error: "Could not generate an unused code. Try again." };
    const created = await createConcessionCode({
      concession: input.concession,
      idempotencyKey: `invite:${email}:${code}`,
      code,
      label: `Invitation for ${email}: ${describeConcession(input.concession)}`,
    });
    if (!created.ok) {
      return { ok: false, error: `Stripe refused to create the discount: ${created.error}` };
    }
    code = created.value.code;
    couponId = created.value.couponId;
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

  const row = await queryOne<{ id: string }>(
    `insert into account_invitations
       (email, invited_by_email, invited_by_user_id, plan_key, billing_interval,
        concession_kind, concession_percent, concession_months,
        concession_code, stripe_coupon_id,
        token_hash, expires_at, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id`,
    [
      email,
      input.adminEmail,
      input.adminUserId ?? null,
      input.plan,
      input.interval,
      input.concession.kind,
      input.concession.percent ?? null,
      input.concession.months ?? null,
      code,
      couponId,
      hashToken(token),
      expires.toISOString(),
      input.note?.trim() || null,
    ]
  );
  if (!row) return { ok: false, error: "Could not save the invitation." };

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "invitation_created",
    detail: {
      email,
      plan: input.plan,
      interval: input.interval,
      terms: describeConcession(input.concession),
      code,
      expires_at: expires.toISOString(),
    },
  });

  const mail = await sendInvitationEmail({
    to: email,
    token,
    inviterEmail: input.adminEmail,
    terms: describeConcession(input.concession),
    plan: input.plan,
    interval: input.interval,
    note: input.note ?? null,
    expiresAt: expires,
  });

  return {
    ok: true,
    invitationId: row.id,
    message: mail.sent
      ? `Invited ${email}. The link expires ${expires.toDateString()}.`
      : `Invitation saved for ${email}, but the email could not be sent (${mail.error}). Re-send once platform mail is connected.`,
  };
}

/* -------------------------------------------------------------------------
 * Managing
 * ---------------------------------------------------------------------- */

export async function revokeInvitation(input: {
  id: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const row = await queryOne<InvitationRow>(`${INVITATION_SELECT} where id = $1`, [input.id]);
  if (!row) return { ok: false, error: "That invitation no longer exists." };
  if (row.accepted_at) {
    return {
      ok: false,
      error: `${row.email} has already accepted. Change the terms from their account page instead.`,
    };
  }

  // Conditional, for the same reason redemption is: somebody may be accepting
  // this invitation right now. Revoking unconditionally would set revoked_at
  // on an invitation that has just been accepted and then turn off the
  // promotion code belonging to a real customer who has not checked out yet,
  // quietly taking away the discount they were promised.
  const won = await queryOne<{ id: string }>(
    `update account_invitations
        set revoked_at = now(), revoked_by = $2
      where id = $1 and accepted_at is null and revoked_at is null
      returning id`,
    [input.id, input.adminEmail]
  );
  if (!won) {
    return {
      ok: false,
      error: `${row.email} accepted this invitation a moment ago, so there is nothing left to withdraw. Change their terms from their account page instead.`,
    };
  }

  // The link is dead, so the coupon behind it has nothing left to attach to.
  // Delete it rather than leave a live discount object lying around. Only
  // after winning the update above: a coupon belonging to an account that has
  // already accepted must be left alone. Deleting a Stripe coupon does not
  // disturb discounts already applied to a running subscription, so even that
  // ordering error would not take a discount off a paying customer.
  if (row.stripe_coupon_id) {
    const gone = await deleteConcessionCoupon(row.stripe_coupon_id);
    if (!gone.ok) {
      // Not worth failing the withdrawal over. Nobody can redeem a coupon;
      // only we can attach one, and the invitation it belonged to is dead.
      console.error(
        "[invitations] coupon left behind at Stripe",
        row.concession_code,
        gone.error
      );
    }
  }

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "invitation_revoked",
    detail: { email: row.email, code: row.concession_code },
  });
  return { ok: true, message: `The invitation to ${row.email} has been withdrawn.` };
}

/**
 * Send it again with a fresh link.
 *
 * The old token stops working. Two live links to the same invitation would
 * mean the one somebody forwards still works after the one we meant to replace
 * was superseded, and there is no reason to want that.
 */
export async function resendInvitation(input: {
  id: string;
  adminEmail: string;
}): Promise<AdminActionResult> {
  const row = await queryOne<InvitationRow>(`${INVITATION_SELECT} where id = $1`, [input.id]);
  if (!row) return { ok: false, error: "That invitation no longer exists." };
  const state = invitationState(row);
  if (state === "accepted") {
    return { ok: false, error: `${row.email} has already accepted this invitation.` };
  }
  if (state === "revoked") {
    return { ok: false, error: "This invitation was withdrawn. Create a new one instead." };
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  // Conditional for the same reason as revoke. Re-sending an invitation that
  // was accepted between the read above and this write would hand out a
  // working link to an account that already exists.
  const won = await queryOne<{ id: string }>(
    `update account_invitations
        set token_hash = $2, expires_at = $3,
            sent_count = sent_count + 1, last_sent_at = now()
      where id = $1 and accepted_at is null and revoked_at is null
      returning id`,
    [input.id, hashToken(token), expires.toISOString()]
  );
  if (!won) {
    return {
      ok: false,
      error: `${row.email} accepted or the invitation was withdrawn a moment ago. Nothing was sent.`,
    };
  }

  const mail = await sendInvitationEmail({
    to: row.email,
    token,
    inviterEmail: input.adminEmail,
    terms: describeConcession({
      kind: row.concession_kind,
      percent: row.concession_percent,
      months: row.concession_months,
    }),
    plan: row.plan_key as "founding" | "standard",
    interval: row.billing_interval as "month" | "year",
    note: row.note,
    expiresAt: expires,
  });

  await recordAdminAction({
    adminEmail: input.adminEmail,
    action: "invitation_resent",
    detail: { email: row.email, sent_count: row.sent_count + 1, delivered: mail.sent },
  });

  return mail.sent
    ? { ok: true, message: `Sent again to ${row.email}. The new link expires ${expires.toDateString()}.` }
    : { ok: false, error: `Could not send the email: ${mail.error}` };
}

/**
 * The plan and interval an account was invited on, if it has not subscribed
 * to anything yet.
 *
 * Checkout normally reads the plan from the query string and then checks it
 * against the public founding window. Neither is right for an invited
 * account: the terms were agreed in advance, so the query string is an
 * opportunity to be charged something other than what was agreed, and the
 * public window has nothing to do with a private arrangement, so a founding
 * invitation accepted after the window closed would silently become standard.
 *
 * The binding lapses once they have a subscription, because from then on
 * changing plan is an ordinary thing to want to do and they do it through the
 * billing portal.
 */
/**
 * Put right an invitation that was accepted but whose terms never landed.
 *
 * Migration 048 records this state deliberately, and until now fixing it meant
 * an admin noticing the flag on the invitations list and re-granting the
 * concession by hand. Nobody watches a list for a row that looks normal, so
 * the customer found out on an invoice instead.
 *
 * The write is the same transaction acceptance uses, so it is the terms and
 * the stamp together or neither, and the `terms_applied_at is null` guard in
 * the statement means two sweeps racing cannot apply a concession twice.
 * Deciding WHETHER to repair is not this function's job: concession-integrity
 * owns that, because the dangerous cases (an account that has since started
 * paying, one that already has a discount) must be refused, not guessed at.
 */
export async function repairInvitedTerms(input: {
  id: string;
  actorEmail: string;
}): Promise<AdminActionResult> {
  const row = await queryOne<InvitationRow>(`${INVITATION_SELECT} where id = $1`, [
    input.id,
  ]);
  if (!row) return { ok: false, error: "That invitation no longer exists." };
  if (!row.accepted_at || !row.accepted_org_id) {
    return { ok: false, error: "That invitation was never accepted." };
  }
  if (row.terms_applied_at) {
    return { ok: false, error: "Those terms are already on the account." };
  }

  const terms = describeConcession({
    kind: row.concession_kind as ConcessionKind,
    percent: row.concession_percent,
    months: row.concession_months,
  });

  await applyInvitedTermsAtomically(row, row.accepted_org_id, terms);
  await recordAdminAction({
    adminEmail: input.actorEmail,
    action: "invitation_terms_repaired",
    orgId: row.accepted_org_id,
    detail: {
      invitation_id: row.id,
      email: row.email,
      terms,
      invited_by: row.invited_by_email,
    },
  }).catch(() => undefined);

  return {
    ok: true,
    message: `Applied ${terms} to ${row.email}'s account.`,
  };
}

export async function invitedTermsForOrg(
  orgId: string
): Promise<{ plan: "founding" | "standard"; interval: "month" | "year" } | null> {
  const row = await queryOne<{ plan_key: string; billing_interval: string }>(
    `select plan_key, billing_interval
       from account_invitations
      where accepted_org_id = $1
        and accepted_at is not null
        and terms_applied_at is not null
      order by accepted_at desc
      limit 1`,
    [orgId]
  ).catch(() => null);
  if (!row) return null;
  if (row.plan_key !== "founding" && row.plan_key !== "standard") return null;
  return {
    plan: row.plan_key,
    interval: row.billing_interval === "year" ? "year" : "month",
  };
}

/* -------------------------------------------------------------------------
 * The email
 * ---------------------------------------------------------------------- */

export function invitationUrl(token: string): string {
  return `${config.appUrl.replace(/\/$/, "")}/invite?token=${token}`;
}

async function sendInvitationEmail(input: {
  to: string;
  token: string;
  inviterEmail: string;
  terms: string;
  plan: "founding" | "standard";
  interval: "month" | "year";
  note: string | null;
  expiresAt: Date;
}): Promise<{ sent: boolean; error?: string }> {
  const url = invitationUrl(input.token);
  const { PLANS } = await import("../billing/catalog");
  const planName = PLANS[input.plan]?.name ?? "Brost Co";
  const expiry = input.expiresAt.toDateString();

  const text = [
    `${input.inviterEmail} has invited you to Brost Co.`,
    "",
    "Brost Co finds federal contracting opportunities that fit your company, scores them, and runs the subcontractor outreach for the ones worth bidding.",
    "",
    `Your plan: ${planName}, billed ${input.interval === "year" ? "annually" : "monthly"}.`,
    `Your terms: ${input.terms}`,
    ...(input.note ? ["", input.note] : []),
    "",
    "Set up your account here:",
    url,
    "",
    `This link works until ${expiry}, and only once.`,
    "",
    "If you were not expecting this, you can ignore it and nothing will happen.",
  ].join("\n");

  if (!(await systemMail.enabled())) {
    // Same posture as password reset: print the link in development so the
    // flow can be walked end to end, and stay quiet in production rather than
    // writing a working invitation link into the logs.
    if (!config.isProd) console.info(`[invitation] ${input.to}: ${url}`);
    return { sent: false, error: "platform inbox is not connected" };
  }
  const res = await systemMail
    .send({ to: input.to, subject: `${input.inviterEmail} invited you to Brost Co`, text })
    .catch((err: unknown) => ({ error: (err as Error).message }) as { error: string });

  if ("error" in res && res.error) return { sent: false, error: res.error };
  return { sent: true };
}

/* -------------------------------------------------------------------------
 * Redeeming
 * ---------------------------------------------------------------------- */

export interface InvitationOffer {
  id: string;
  email: string;
  invitedBy: string;
  planKey: "founding" | "standard";
  interval: "month" | "year";
  terms: string;
  note: string | null;
  expiresAt: string;
}

/** Read an invitation for display, without claiming it. */
export async function invitationForToken(token: string): Promise<InvitationOffer | null> {
  if (!token) return null;
  const row = await queryOne<InvitationRow>(
    `${INVITATION_SELECT} where token_hash = $1`,
    [hashToken(token)]
  ).catch(() => null);
  if (!row || invitationState(row) !== "outstanding") return null;
  return {
    id: row.id,
    email: row.email,
    invitedBy: row.invited_by_email,
    planKey: row.plan_key as "founding" | "standard",
    interval: row.billing_interval as "month" | "year",
    terms: describeConcession({
      kind: row.concession_kind,
      percent: row.concession_percent,
      months: row.concession_months,
    }),
    note: row.note,
    expiresAt: row.expires_at,
  };
}

export interface RedeemResult {
  ok: true;
  userId: string;
  orgId: string;
  sessionToken: string;
  terms: string;
}

/**
 * Turn an invitation into an account.
 *
 * The order here is the interesting part:
 *
 *   1. Validate everything that can be validated without side effects.
 *   2. Claim the invitation with a conditional update. Exactly one concurrent
 *      request can win this; the loser is told the link has been used.
 *   3. Create the account through the ordinary signup service, so invited
 *      accounts are built by the same code as every other account rather than
 *      by a parallel copy that drifts.
 *   4. Apply the terms.
 *
 * If step 3 fails the claim from step 2 is released, because a link that is
 * dead but never produced an account is the one outcome nobody can recover
 * from without a database console.
 */
export async function redeemInvitation(input: {
  token: string;
  name: string;
  companyName: string;
  password: string;
}): Promise<RedeemResult | { error: string }> {
  const row = await queryOne<InvitationRow>(
    `${INVITATION_SELECT} where token_hash = $1`,
    [hashToken(input.token)]
  ).catch(() => null);
  if (!row) return { error: "This invitation link is not valid." };

  const state = invitationState(row);
  if (state === "accepted") {
    return { error: "This invitation has already been used. Log in instead." };
  }
  if (state === "revoked") return { error: "This invitation was withdrawn." };
  if (state === "expired") {
    return { error: "This invitation has expired. Ask for a new one." };
  }
  if (input.password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }

  // Claim it. `accepted_at is null` in the WHERE clause is the whole
  // concurrency control: the second request updates zero rows.
  const claimed = await queryOne<{ id: string }>(
    `update account_invitations
        set accepted_at = now()
      where id = $1 and accepted_at is null and revoked_at is null and expires_at > now()
      returning id`,
    [row.id]
  );
  if (!claimed) return { error: "This invitation has already been used. Log in instead." };

  const { signupAccount } = await import("../auth-signup");
  const created = await signupAccount({
    email: row.email,
    password: input.password,
    name: input.name,
    companyName: input.companyName,
  }).catch((err: unknown) => ({ error: (err as Error).message }));

  if ("error" in created) {
    // Put the link back. Whatever went wrong (a race with a self-signup on the
    // same address, a database hiccup) is recoverable by trying again, and
    // burning the invitation would make it permanently not.
    await query(`update account_invitations set accepted_at = null where id = $1`, [row.id]).catch(
      () => {}
    );
    return { error: created.error };
  }

  await query(
    `update account_invitations set accepted_user_id = $2, accepted_org_id = $3 where id = $1`,
    [row.id, created.user.id, created.orgId]
  );

  const terms = describeConcession({
    kind: row.concession_kind,
    percent: row.concession_percent,
    months: row.concession_months,
  });

  // The account exists now, so the invitation cannot be released: the address
  // is taken and a second attempt would fail on it. What can still go wrong is
  // this last write, and if it does the customer has an ordinary trial instead
  // of the deal they were promised. That has to be recorded rather than
  // thrown, because throwing would leave them with an account, a session, and
  // an error page saying nothing worked.
  //
  // The terms and the stamp that records them go in ONE transaction. Split
  // across two statements, a failure between them leaves an organization
  // holding a private promotion code that `invitedTermsForOrg` cannot see,
  // which is precisely the mismatch checkout binding exists to prevent: the
  // promo code would be applied to whatever plan the query string asked for.
  // Atomic, the only two outcomes are the agreed terms with a stamp, or
  // nothing at all and an ordinary standard-price account.
  let termsApplied = false;
  for (let attempt = 0; attempt < 2 && !termsApplied; attempt++) {
    try {
      await applyInvitedTermsAtomically(row, created.orgId, terms);
      termsApplied = true;
    } catch (err) {
      console.error(
        `[invitations] account created but terms not applied (attempt ${attempt + 1})`,
        row.id,
        err
      );
    }
  }

  await recordAdminAction({
    adminEmail: row.invited_by_email,
    action: "invitation_accepted",
    orgId: created.orgId,
    orgName: input.companyName.trim() || null,
    userId: created.user.id,
    detail: {
      email: row.email,
      terms,
      code: row.concession_code,
      // Reads as a normal acceptance until this is false, which is exactly
      // when somebody needs to look.
      terms_applied: termsApplied,
    },
  });

  return {
    ok: true,
    userId: created.user.id,
    orgId: created.orgId,
    sessionToken: created.token,
    terms,
  };
}

/**
 * Put the promised terms onto the new account.
 *
 * A free account is our own flag and is set immediately. A discount is a
 * promise held until checkout, because there is no subscription yet to attach
 * a coupon to. Both record the chosen plan so the billing page and the
 * checkout link already know what was agreed.
 */
async function applyInvitedTermsAtomically(
  row: InvitationRow,
  orgId: string,
  terms: string
): Promise<void> {
  const { transaction } = await import("../db");
  await transaction(async (client) => {
    if (row.concession_kind === "free_account") {
      await client.query(
        `update organizations
            set billing_exempt = true,
                billing_exempt_reason = $2,
                billing_exempt_granted_by = $3,
                billing_exempt_granted_at = now(),
                plan_key = $4,
                billing_interval = $5,
                updated_at = now()
          where id = $1`,
        [
          orgId,
          row.note?.trim() || `Invited by ${row.invited_by_email} on free terms.`,
          row.invited_by_email,
          row.plan_key,
          row.billing_interval,
        ]
      );
    } else {
      await client.query(
        `update organizations
            set plan_key = $2,
                billing_interval = $3,
                pending_concession_code = $4,
                pending_coupon_id = $5,
                pending_concession_label = $6,
                pending_concession_reason = $7,
                pending_concession_by = $8,
                pending_concession_at = case when $5::text is null then null else now() end,
                updated_at = now()
          where id = $1`,
        [
          orgId,
          row.plan_key,
          row.billing_interval,
          row.concession_code,
          row.stripe_coupon_id,
          row.stripe_coupon_id ? terms : null,
          row.note?.trim() || `Invited by ${row.invited_by_email}.`,
          row.invited_by_email,
        ]
      );
    }

    // Same transaction as the terms above. This stamp is what checkout binding
    // reads; a stamp without terms, or terms without a stamp, is the state
    // that lets a private promotion code meet a plan nobody agreed to.
    await client.query(
      `update account_invitations set terms_applied_at = now() where id = $1`,
      [row.id]
    );
  });
}
