/**
 * Dev-only helper: mint a session cookie for an existing (or bootstrap) user
 * so visual QA can walk authenticated dash routes without a password.
 *
 * Usage: npx tsx scripts/qa-session.ts
 * Writes token to /tmp/brost-qa-session.txt (mode 600).
 */
import { writeFileSync } from "node:fs";
import { closePool, query, queryOne } from "../lib/db";
import { createSession } from "../lib/auth";
import { createOrganizationForUser } from "../lib/organizations";

async function main() {
  const user = await queryOne<{ id: string; email: string }>(
    `select u.id, u.email
       from users u
       left join organization_members m on m.user_id = u.id
       left join organizations o on o.id = m.org_id
      order by case when o.subscription_status in ('active','trialing') then 0 else 1 end,
               u.email asc
      limit 1`
  );

  if (!user) {
    throw new Error("No users in DB. Create one via /setup or scripts/create-user.ts first.");
  }

  let org = await queryOne<{ id: string; subscription_status: string }>(
    `select o.id, o.subscription_status
       from organizations o
       join organization_members m on m.org_id = o.id
      where m.user_id = $1
      limit 1`,
    [user.id]
  );

  if (!org) {
    org = await createOrganizationForUser({
      userId: user.id,
      name: "QA Workspace",
      email: user.email,
    });
    console.log("created_org");
  }

  if (!["active", "trialing"].includes(org.subscription_status)) {
    await query(
      `update organizations
          set subscription_status = 'active', plan_key = coalesce(nullif(plan_key, 'none'), 'standard')
        where id = $1`,
      [org.id]
    );
    org = { ...org, subscription_status: "active" };
    console.log("activated_subscription");
  }

  const token = await createSession(user.id);
  writeFileSync("/tmp/brost-qa-session.txt", token, { mode: 0o600 });
  console.log("session_ready");
  console.log("user=" + user.email.replace(/(.{2}).+(@.+)/, "$1…$2"));
  console.log("org=" + org.id.slice(0, 8) + "…");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => closePool());
