/**
 * Seed script. Idempotent: only inserts what's missing.
 *   - active Company Profile (v1) from DEFAULT_PROFILE
 *   - active scoring_weights (v1) derived from the rubric
 *   - default templates (1, 3, 4)
 *   - the operator user (from OPERATOR_EMAIL / OPERATOR_PASSWORD_HASH)
 *
 *   npm run db:seed
 */
import { query, queryOne, closePool } from "../lib/db";
import { renderProfileText } from "../lib/ai/companyProfile";
import { DEFAULT_PROFILE, DEFAULT_TEMPLATES } from "../db/seedData";
import { config } from "../lib/config";

async function seedProfile() {
  const existing = await queryOne(`select id from company_profile where is_active = true`);
  if (existing) {
    console.log("= company_profile already active (skip)");
    return;
  }
  const text = renderProfileText(DEFAULT_PROFILE);
  await query(
    `insert into company_profile (version, is_active, profile_json, profile_text, updated_by)
     values (1, true, $1, $2, 'seed')`,
    [JSON.stringify(DEFAULT_PROFILE), text]
  );
  console.log("+ seeded company_profile v1");
}

async function seedScoringWeights() {
  const existing = await queryOne(`select id from scoring_weights where is_active = true`);
  if (existing) {
    console.log("= scoring_weights already active (skip)");
    return;
  }
  const weights: Record<string, { weight: number; label: string }> = {};
  for (const d of DEFAULT_PROFILE.scoring_rubric.dimensions) {
    weights[d.key] = { weight: d.max_points, label: d.label };
  }
  await query(
    `insert into scoring_weights (version, weights, rationale, is_active, proposed_by, approved_at, approved_by)
     values (1, $1, 'Initial rubric from Company Profile', true, 'seed', now(), 'seed')`,
    [JSON.stringify(weights)]
  );
  console.log("+ seeded scoring_weights v1");
}

async function seedTemplates() {
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await queryOne(`select id from templates where slug = $1 and is_active = true`, [
      t.slug,
    ]);
    if (existing) {
      console.log(`= template ${t.slug} exists (skip)`);
      continue;
    }
    await query(
      `insert into templates (slug, version, is_active, subject, body, description)
       values ($1, 1, true, $2, $3, $4)`,
      [t.slug, t.subject, t.body, t.description]
    );
    console.log(`+ seeded template ${t.slug}`);
  }
}

async function seedOperator() {
  if (!config.auth.operatorEmail || !config.auth.operatorPasswordHash) {
    console.log(
      "= operator not seeded (set OPERATOR_EMAIL + OPERATOR_PASSWORD_HASH, then re-run db:seed). Generate a hash: npm run agent -- hash-password 'yourpassword'"
    );
    return;
  }
  const existing = await queryOne(`select id from users where email = $1`, [
    config.auth.operatorEmail,
  ]);
  if (existing) {
    console.log("= operator user exists (skip)");
    return;
  }
  await query(
    `insert into users (email, password_hash, name, role) values ($1, $2, 'Operator', 'operator')`,
    [config.auth.operatorEmail, config.auth.operatorPasswordHash]
  );
  console.log(`+ seeded operator user ${config.auth.operatorEmail}`);
}

async function main() {
  await seedProfile();
  await seedScoringWeights();
  await seedTemplates();
  await seedOperator();
  console.log("Seed complete.");
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
