/** Opt-in, synthetic-only development checks. No worker or customer workflows. */
import { config } from "../lib/config";
import { closePool, query } from "../lib/db";
import { LEGACY_ORG_ID, runWithOrg } from "../lib/tenant-context";
import { planRoute } from "../lib/ai/claude";
import { extractReplyFromReply } from "../lib/ai/reply-extract";
import { reviewAnalysis } from "../lib/ai/analysis-review";

async function main() {
  if (process.env.RUN_GPT41_SMOKE !== "1") throw new Error("Explicit RUN_GPT41_SMOKE=1 opt-in required; up to five billable attempts.");
  if (!config.database.isIsolatedDev || process.env.MIGRATION_DATABASE_URL?.trim()) {
    throw new Error("Smoke checks require isolated development without production migration credentials.");
  }
  const orgId = process.env.GPT41_SMOKE_ORG_ID || LEGACY_ORG_ID;
  const started = new Date().toISOString();
  await runWithOrg(orgId, async () => {
    for (const complexity of ["routine", "complex"] as const) {
      const route = await planRoute({ complexity });
      if (route?.primary.provider !== "OpenAI" || route.primary.model !== "gpt-4.1" || route.fallback) {
        throw new Error("Both routes must resolve to GPT-4.1 without fallback.");
      }
    }
    // The two extraction calls permit one schema retry each; review permits none.
    const cents = await extractReplyFromReply("Our firm total for all requested work is $1,234.56. Tax and delivery are included.", { opportunityTitle: "Synthetic release test", trade: "Painting" });
    const range = await extractReplyFromReply("Our estimate is between $10,000 and $12,000. We cannot provide a firm total until the site visit.", { opportunityTitle: "Synthetic release test", trade: "Painting" });
    const issues = await reviewAnalysis(
      "Amendment 0002: Bid deadline is November 19, 2026 at 2 PM America/Denver. Signed acknowledgment is required.\nAmendment 0001: Bid deadline is November 16, 2026 at 2 PM America/Denver.\nOriginal notice: Bid deadline is November 12, 2026 at 2 PM America/Denver.",
      { deadline: "2026-11-16T21:00:00Z", signature_required: false, compliance_matrix: [] },
      "2026-11-16T21:00:00Z",
    );
    const checks = {
      cents: { passed: cents.method === "ai" && cents.quoteAmount === 1234.56, method: cents.method, amount: cents.quoteAmount },
      range: { passed: range.method === "ai" && range.quoteAmount === null && range.missingFields.length > 0, method: range.method, amount: range.quoteAmount, missing: range.missingFields },
      deadline: { passed: issues.some(i => /deadline.*reconciliation/i.test(i)), issues },
    };
    const usage = await query("select service as model, outcome, billing_status, estimated_cost, provider_cost from api_usage_events where org_id=$1 and started_at >= $2 order by started_at", [orgId, started]);
    console.log(JSON.stringify({ checks, usage }, null, 2));
    if (Object.values(checks).some(c => !c.passed)) throw new Error("Synthetic GPT-4.1 checks failed; do not publish.");
  });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Smoke validation failed");
  process.exitCode = 1;
}).finally(closePool);
