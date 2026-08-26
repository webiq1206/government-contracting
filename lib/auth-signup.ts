/**
 * Self-serve account creation for SaaS signup.
 */
import { queryOne, transaction } from "./db";
import { hashPassword, createSession, type SessionUser } from "./auth";
import { createOrganizationForUser } from "./organizations";
import { trackEvent } from "./analytics";

/**
 * Whether an address can still be claimed.
 *
 * Checks aliases as well as accounts. An address that is somebody's alias is
 * as taken as one that is somebody's account: letting signup claim it would
 * hand a stranger a working front door to an existing account. A trigger in
 * migration 044 enforces the same rule in the database; this exists so the
 * caller gets a sentence instead of a constraint violation.
 */
export async function emailTaken(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const row = await queryOne<{ id: string }>(
    `select id from users where lower(email) = $1
      union all
     select id from user_email_aliases where lower(email) = $1
      limit 1`,
    [normalized]
  );
  return Boolean(row);
}

export async function signupAccount(input: {
  email: string;
  password: string;
  name: string;
  companyName: string;
  /** For the sessions list, so the first device is recognisable later. */
  userAgent?: string | null;
}): Promise<{ user: SessionUser; orgId: string; token: string } | { error: string }> {
  const email = input.email.toLowerCase().trim();
  if (!email.includes("@") || email.length < 5) {
    return { error: "Enter a valid work email." };
  }
  if (input.password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }
  if (await emailTaken(email)) {
    return { error: "An account with that email already exists. Log in instead." };
  }

  const password_hash = hashPassword(input.password);
  // User, organization, membership, and profile shell are one atomic unit: a
  // failure anywhere rolls all of it back. A partial signup used to strand a
  // users row that blocked the email address while owning nothing.
  const { user, org } = await transaction(async (client) => {
    const created = await client.query<{ id: string; email: string; name: string | null; role: string }>(
      `insert into users (email, password_hash, name, role)
       values ($1, $2, $3, 'operator')
       returning id, email, name, role`,
      [email, password_hash, input.name.trim() || null]
    );
    const user = created.rows[0];
    if (!user) throw new Error("Could not create account.");
    const org = await createOrganizationForUser(
      {
        userId: user.id,
        name: input.companyName.trim() || input.name.trim() || "My company",
        email,
      },
      client
    );
    return { user, org };
  });

  const token = await createSession(user.id, input.userAgent ?? null);
  await trackEvent({
    event: "account_created",
    orgId: org.id,
    userId: user.id,
    path: "/signup",
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      // addMember creates the signing-up user as the owner of the new
      // organization, so this is not a guess.
      orgRole: "owner",
      organizationId: org.id,
      subscriptionStatus: org.subscription_status,
      planKey: org.plan_key,
      trialEndsAt: org.trial_ends_at,
      billingExempt: Boolean(org.billing_exempt),
      suspendedAt: org.suspended_at,
      impersonatedBy: null,
    },
    orgId: org.id,
    token,
  };
}
