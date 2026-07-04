/**
 * Idempotent seed. Publishes the active Company Profile (real BROSTCO v1.2),
 * the active scoring_weights, and the default email templates if they are not
 * already present. Runs on boot after migrations. Never overwrites operator edits.
 */
import { query, queryOne } from "./db";
import { renderProfileText } from "./ai/companyProfile";
import { DEFAULT_PROFILE, DEFAULT_TEMPLATES } from "./seed-data";
import type { CompanyProfileJson } from "./types";

export async function runSeed(): Promise<{ seeded: string[] }> {
  const seeded: string[] = [];

  const active = await queryOne<{ id: string; profile_json: CompanyProfileJson; updated_by: string | null }>(
    `select id, profile_json, updated_by from company_profile where is_active = true`
  );
  if (!active) {
    await query(
      `insert into company_profile (version, is_active, profile_json, profile_text, updated_by)
       values (1, true, $1, $2, 'seed')`,
      [JSON.stringify(DEFAULT_PROFILE), renderProfileText(DEFAULT_PROFILE)]
    );
    seeded.push("company_profile");
  } else if (active.updated_by === "seed") {
    // Keep a seed-authored profile in sync with code defaults (never touches
    // operator edits — those carry a different updated_by). Backfills newly
    // added threshold defaults and re-renders the injected profile text.
    const json = active.profile_json;
    const t = json.decision_thresholds;
    let changed = false;
    if (t && t.block_prime_only === undefined) {
      t.block_prime_only = false;
      changed = true;
    }
    const text = renderProfileText(json);
    await query(
      `update company_profile set profile_json = $2, profile_text = $3 where id = $1`,
      [active.id, JSON.stringify(json), text]
    );
    if (changed) seeded.push("company_profile:refreshed");
  }

  const hasWeights = await queryOne(`select id from scoring_weights where is_active = true`);
  if (!hasWeights) {
    const weights: Record<string, { weight: number; label: string }> = {};
    for (const d of DEFAULT_PROFILE.scoring_rubric.dimensions) {
      weights[d.key] = { weight: d.max_points, label: d.label };
    }
    await query(
      `insert into scoring_weights (version, weights, rationale, is_active, proposed_by, approved_at, approved_by)
       values (1, $1, 'Initial rubric from Company Profile', true, 'seed', now(), 'seed')`,
      [JSON.stringify(weights)]
    );
    seeded.push("scoring_weights");
  }

  for (const t of DEFAULT_TEMPLATES) {
    const exists = await queryOne(`select id from templates where slug = $1 and is_active = true`, [t.slug]);
    if (!exists) {
      await query(
        `insert into templates (slug, version, is_active, subject, body, description)
         values ($1, 1, true, $2, $3, $4)`,
        [t.slug, t.subject, t.body, t.description]
      );
      seeded.push(`template:${t.slug}`);
    }
  }

  return { seeded };
}

// Standalone: `tsx src/engine/seed.ts`. Argv check is bundling-safe (see migrate.ts).
if (process.argv[1]?.endsWith("seed.ts")) {
  runSeed()
    .then((r) => {
      console.log("[seed]", r.seeded.length ? r.seeded.join(", ") : "nothing to seed");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
