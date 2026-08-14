/**
 * Company Profile, persistent system context. Loaded from the company_profile
 * table (single active, versioned row) and injected as the system prompt into
 * every Claude API call. "When updated, all agents immediately operate from the
 * new version", so we cache with a short TTL and bust the cache on write.
 */
import { queryOne, query } from "../db";
import { noEmDash } from "../sanitize";
import { defaultCompanyProfile } from "../domain/default-profile";
import type { CompanyProfile, CompanyProfileJson } from "../types";
import { currentOrgId, LEGACY_ORG_ID } from "../tenant-context";

// Short TTL: invalidateProfileCache() busts this process's cache on write, but a
// separate worker process only picks up a newly-published profile after the TTL,
// so keep it small to minimize the cross-process window (agents scoring in the
// gap would otherwise use the old rules/thresholds).
const CACHE_TTL_MS = 5_000;
let _cache: { orgId: string; profile: CompanyProfile; at: number } | null = null;

async function resolveProfileOrgId(): Promise<string> {
  const fromAls = currentOrgId();
  if (fromAls) return fromAls;
  // Lazy import avoids a circular auth ↔ profile dependency at module load.
  try {
    const { currentUser } = await import("../auth");
    const user = await currentUser().catch(() => null);
    if (user?.organizationId) return user.organizationId;
  } catch {
    /* worker / non-request context */
  }
  return LEGACY_ORG_ID;
}

export async function getActiveProfile(
  opts: { fresh?: boolean } = {}
): Promise<CompanyProfile | null> {
  const orgId = await resolveProfileOrgId();
  if (
    !opts.fresh &&
    _cache &&
    _cache.orgId === orgId &&
    Date.now() - _cache.at < CACHE_TTL_MS
  ) {
    return _cache.profile;
  }
  const row = await queryOne<CompanyProfile>(
    `select * from company_profile
      where is_active = true and org_id = $1
      limit 1`,
    [orgId]
  );
  // No unscoped fallback. It existed for the window before 028 backfilled
  // org_id; now that several orgs can each hold an active profile, "any
  // active row" could be another tenant's company identity, which would then
  // be injected into this tenant's AI prompts and outgoing documents.
  if (!row) return null;
  const profile = { ...row, profile_json: withProfileDefaults(row.profile_json) };
  _cache = { orgId, profile, at: Date.now() };
  return profile;
}

/**
 * Fill in any section a stored profile is missing.
 *
 * Every consumer of this object reaches straight into a nested section
 * (`decision_thresholds.pursue_min_score`, `scoring_rubric.dimensions`,
 * `pricing_rules.out_of_range_tolerance_pct`), so a partial profile is not a
 * degraded experience, it is a crash. Profiles written before the signup
 * defaults existed are exactly that, and repairing on read fixes those
 * accounts without a migration and without anyone having to notice.
 *
 * Only missing sections are filled. Anything the customer has actually set is
 * left alone, including values that differ from our defaults.
 */
export function withProfileDefaults(
  stored: Partial<CompanyProfileJson> | null | undefined
): CompanyProfileJson {
  const s = (stored ?? {}) as Partial<CompanyProfileJson>;
  const defaults = defaultCompanyProfile({
    legalName: s.legal_name ?? "My company",
    email: s.email ?? "",
    ownerName: s.owner_name ?? null,
  });
  return {
    ...defaults,
    ...s,
    // Nested sections merge one level deep: a profile that has
    // decision_thresholds but is missing a key added later should not lose the
    // rest of the object to a shallow spread.
    scoring_rubric: s.scoring_rubric?.dimensions?.length
      ? s.scoring_rubric
      : defaults.scoring_rubric,
    hard_exclusions: s.hard_exclusions?.length ? s.hard_exclusions : defaults.hard_exclusions,
    sub_standards: { ...defaults.sub_standards, ...(s.sub_standards ?? {}) },
    pricing_rules: { ...defaults.pricing_rules, ...(s.pricing_rules ?? {}) },
    decision_thresholds: {
      ...defaults.decision_thresholds,
      ...(s.decision_thresholds ?? {}),
    },
  };
}

export function invalidateProfileCache(): void {
  _cache = null;
}

/** The exact text injected into every Claude system prompt. */
export async function getProfileSystemText(): Promise<string> {
  const p = await getActiveProfile();
  if (!p) {
    return "No Company Profile is configured yet. Operate conservatively and flag all consequential decisions for human review.";
  }
  return p.profile_text;
}

export async function getProfileJson(): Promise<CompanyProfileJson | null> {
  const p = await getActiveProfile();
  return (p?.profile_json as CompanyProfileJson) ?? null;
}

/**
 * Publish a new active profile version. Deactivates the current active row and
 * inserts a new one at version+1. Returns the new profile.
 */
export async function publishProfile(
  json: CompanyProfileJson,
  rawText: string,
  updatedBy: string
): Promise<CompanyProfile> {
  // The rendered profile is injected into every Claude prompt and printed on
  // generated documents, so it is customer-facing twice over.
  const text = noEmDash(rawText);
  const orgId = await resolveProfileOrgId();
  const current = await queryOne<{ max: number }>(
    `select coalesce(max(version),0) as max from company_profile where org_id = $1`,
    [orgId]
  );
  const nextVersion = (current?.max ?? 0) + 1;
  await query(
    `update company_profile set is_active = false where is_active = true and org_id = $1`,
    [orgId]
  );
  const inserted = await queryOne<CompanyProfile>(
    `insert into company_profile (org_id, version, is_active, profile_json, profile_text, updated_by)
     values ($1, $2, true, $3, $4, $5)
     returning *`,
    [orgId, nextVersion, JSON.stringify(json), text, updatedBy]
  );
  invalidateProfileCache();
  return inserted!;
}

/**
 * Render a profile JSON object into the injected text form. Kept deterministic
 * so a re-render of the same JSON is stable (used by the settings editor).
 */
export function renderProfileText(p: CompanyProfileJson): string {
  const lines: string[] = [];
  lines.push(`# ${p.legal_name}${p.dba ? ` (DBA ${p.dba})` : ""}, Company Profile`);
  lines.push("");
  lines.push("You are an autonomous procurement agent operating on behalf of this company. Use this profile as authoritative context for every decision: who we are, what work we pursue, how to score opportunities, how to price bids, which subcontractors meet our standards, and every decision threshold. When a rule here conflicts with a general instinct, follow the rule.");
  lines.push("");
  lines.push("## Identity");
  lines.push(`- Legal name (use EXACTLY, never abbreviate): ${p.legal_name}`);
  if (p.business_structure) lines.push(`- Structure: ${p.business_structure}`);
  if (p.owner_name) lines.push(`- Owner / authorized signer: ${p.owner_name}${p.owner_title ? ` (${p.owner_title})` : ""}`);
  if (p.uei) lines.push(`- UEI: ${p.uei}`);
  else lines.push("- UEI: not yet assigned (SAM.gov registration pending), block bid submission until active.");
  if (p.cage_code) lines.push(`- CAGE: ${p.cage_code}`);
  if (p.ein) lines.push(`- EIN: ${p.ein}`);
  if (p.entity_state) lines.push(`- State of formation: ${p.entity_state}`);
  if (p.physical_address) lines.push(`- Address: ${p.physical_address}`);
  if (p.phone) lines.push(`- Phone: ${p.phone}`);
  if (p.outreach_email) lines.push(`- Outreach email (ALL sub outreach must originate here): ${p.outreach_email}`);
  lines.push(`- Small business: ${p.small_business ? "yes" : "no"}`);
  if (p.business_model) lines.push(`- Business model: ${p.business_model}, we win contracts and fulfill them through vetted local subcontractors; we do not self-perform.`);
  if (p.certifications?.length) lines.push(`- Certifications: ${p.certifications.join(", ")}`);
  lines.push("");
  lines.push("## What we pursue");
  lines.push(`- Active NAICS (${p.naics_codes.length}): ${p.naics_codes.join(", ")}`);
  if (p.excluded_naics?.length) lines.push(`- Excluded NAICS (do not add without human approval): ${p.excluded_naics.join(", ")}`);
  if (p.psc_codes?.length) lines.push(`- PSC: ${p.psc_codes.join(", ")}`);
  lines.push(`- Primary trades: ${p.primary_trades.join(", ")}`);
  lines.push(`- Service areas: ${p.service_areas.join(", ")}`);
  const dt = p.decision_thresholds;
  if (dt.value_min || dt.value_max) {
    lines.push(`- Target contract value: $${(dt.value_min ?? 0).toLocaleString()}-$${(dt.value_max ?? 0).toLocaleString()}. Below minimum: auto-dismiss. Above maximum: flag for review (only after 3+ contracts won).`);
  }
  lines.push("- Highest priority: multi-year and IDIQ vehicles. Small Business set-asides preferred over unrestricted.");
  lines.push("");
  lines.push("## Pricing");
  if (p.pricing_philosophy) lines.push(p.pricing_philosophy);
  lines.push(`- Target margin: ${p.target_margin_pct}%; minimum floor: ${p.min_margin_pct}%.`);
  lines.push(`- Margin scenarios to model: ${p.pricing_rules.margin_scenarios.map((m) => `${m}%`).join(", ")}. Gross margin = (bid − sub quote) / bid, computed on total value including all option years.`);
  lines.push(`- Never estimate sub cost, always use an actual written quote (the cost floor). Collect quotes from at least 2 subs.`);
  lines.push(`- Flag quotes out of range beyond ±${p.pricing_rules.out_of_range_tolerance_pct}% of historical comps.`);
  if (p.pricing_rules.margin_by_category?.length) {
    lines.push("- Margin targets by contract type (target / hard floor / cap):");
    for (const m of p.pricing_rules.margin_by_category) {
      lines.push(`  - ${m.category}: ${m.target_low_pct}-${m.target_high_pct}% / floor ${m.floor_pct}% / cap ${m.cap_pct}%`);
    }
    if (p.pricing_rules.remote_premium_pct) lines.push(`  - Remote location (>80mi from a metro): +${p.pricing_rules.remote_premium_pct}% to the applicable floor.`);
    if (p.pricing_rules.new_naics_learning_premium_pct) lines.push(`  - First bid in a new NAICS: +${p.pricing_rules.new_naics_learning_premium_pct}% to target margin (learning premium).`);
  }
  lines.push("");
  lines.push("## Scoring rubric (100 points)");
  for (const d of p.scoring_rubric.dimensions) {
    lines.push(`- ${d.label} (${d.max_points} pts): ${d.guidance}`);
  }
  lines.push("");
  lines.push("## Hard exclusions (checked FIRST, any hit means dismiss)");
  for (const h of p.hard_exclusions) {
    lines.push(`- ${h.label}: ${h.rule}`);
  }
  lines.push("");
  lines.push("## Decision thresholds");
  const t = p.decision_thresholds;
  lines.push(`- Pursue at score >= ${t.pursue_min_score}; Review at ${t.review_min_score}-${t.pursue_min_score - 1}; Dismiss below ${t.review_min_score}.`);
  lines.push(`- AUTO-PURSUE is unconditional at or above ${t.pursue_min_score}: any non-excluded opportunity scoring >= ${t.pursue_min_score} is pursued automatically (analysis, pricing, sub research, outreach) with no human gate. Risk conditions (high value, new NAICS, unusual clauses, prime-only past performance) do NOT stop it; a human still reviews before any bid is submitted.`);
  lines.push(`- Review-tier items auto-dismiss after ${t.review_auto_dismiss_hours} hours without action.`);
  lines.push(`- Require at least ${t.min_subs_per_trade} verified subs per trade or flag for human review.`);
  lines.push(`- Always submit at least ${t.submit_lead_hours} hours before the deadline.`);
  lines.push(`- Non-small-business sub spend cap: ${t.non_ss_cap_pct}% (alert at ${t.non_ss_alert_pct}%).`);
  lines.push("");
  lines.push("## Subcontractor standards");
  const s = p.sub_standards;
  if (s.min_google_rating) lines.push(`- Minimum Google rating: ${s.min_google_rating}`);
  if (s.min_reviews) lines.push(`- Minimum reviews: ${s.min_reviews}`);
  lines.push(`- Active license required: ${s.require_active_license ? "yes" : "no"}`);
  lines.push(`- Must not be SAM-excluded: ${s.require_not_sam_excluded ? "yes" : "no"}`);
  lines.push(`- Candidates per trade: ${s.candidates_per_trade}; verify top ${s.verify_top_n}.`);
  lines.push("");
  lines.push("## Past-performance policy");
  if (t.block_prime_only) {
    lines.push("- If a solicitation's past-performance requirement is classified prime_only, BLOCK and flag for human review (we cannot yet meet it as prime).");
  } else {
    lines.push("- If a solicitation's past-performance requirement is classified prime_only, FLAG it but still proceed (operator preference: auto-pursue everything above the score). A human reviews before submission.");
  }
  lines.push("- If team_accepted, generate the experience narrative from subcontractor project history.");
  lines.push("- If not_required, omit the past-performance section.");
  if (p.legal_guardrails?.length) {
    lines.push("");
    lines.push("## Legal guardrails (NON-NEGOTIABLE, never override; any ambiguity stops and escalates to human review)");
    for (const g of p.legal_guardrails) lines.push(`- ${g}`);
  }
  if (p.notes) {
    lines.push("");
    lines.push("## Notes");
    lines.push(p.notes);
  }
  return lines.join("\n");
}
