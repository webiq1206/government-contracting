/**
 * Self-serve account creation for SaaS signup.
 */
import { query, queryOne } from "./db";
import { hashPassword, createSession, type SessionUser } from "./auth";
import { createOrganizationForUser } from "./organizations";
import { trackEvent } from "./analytics";

export async function emailTaken(email: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from users where email = $1`,
    [email.toLowerCase().trim()]
  );
  return Boolean(row);
}

export async function signupAccount(input: {
  email: string;
  password: string;
  name: string;
  companyName: string;
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
  const user = await queryOne<{ id: string; email: string; name: string | null; role: string }>(
    `insert into users (email, password_hash, name, role)
     values ($1, $2, $3, 'operator')
     returning id, email, name, role`,
    [email, password_hash, input.name.trim() || null]
  );
  if (!user) return { error: "Could not create account." };

  const org = await createOrganizationForUser({
    userId: user.id,
    name: input.companyName.trim() || input.name.trim() || "My company",
    email,
  });

  const token = await createSession(user.id);
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
      organizationId: org.id,
      subscriptionStatus: org.subscription_status,
      planKey: org.plan_key,
    },
    orgId: org.id,
    token,
  };
}
