import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "db/migrations/102_public_schema_lockdown.sql"),
  "utf8"
);

const previouslyUnprotected = [
  "integration_settings",
  "subcontractor_reply_events",
  "stripe_events",
  "influencers",
  "influencer_codes",
  "referral_attributions",
  "commission_events",
  "influencer_payouts",
  "subcontractor_documents",
  "subcontractor_payments",
  "user_email_aliases",
  "admin_audit_log",
  "reply_drafts",
  "account_invitations",
  "platform_key_grants",
  "platform_key_usage",
  "sam_daily_calls",
  "email_suppressions",
  "conversation_flags",
  "automation_incidents",
  "incident_events",
  "incident_requeues",
  "unmatched_inbound",
  "bid_submission_events",
  "bid_overrides",
  "trade_pricing_rows",
  "bid_calculation_snapshots",
  "outreach_suppressions",
  "solicitation_verifications",
  "saved_views",
  "requirement_states",
  "requirement_state_events",
  "subcontractor_performance_events",
  "subcontractor_merges",
  "subcontractor_contacts",
  "subcontractor_licenses",
  "subcontractor_tags",
  "subcontractor_bulk_actions",
  "compliance_item_events",
  "contract_milestones",
  "contract_modifications",
  "contract_invoices",
  "contract_issues",
  "contract_coordination",
  "compliance_item_documents",
  "billing_invoices",
  "feedback_reports",
] as const;

describe("public schema lockdown migration", () => {
  it("includes every table found outside the prior RLS sweeps", () => {
    for (const table of previouslyUnprotected) {
      expect(sql, `${table} must be locked down`).toContain(`'${table}'`);
    }
  });

  it("enables RLS and revokes every untrusted PostgREST role", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.%I from public/i);
    expect(sql).toMatch(/revoke all on table public\.%I from anon/i);
    expect(sql).toMatch(/revoke all on table public\.%I from authenticated/i);
  });

  it("keeps the owner-based server path working and closes future default grants", () => {
    expect(sql).not.toMatch(/alter table[^;]*force row level security/i);
    expect(sql).toMatch(/alter default privileges in schema public revoke all on tables/i);
    expect(sql).toMatch(/alter default privileges in schema public revoke all on sequences/i);
  });
});
