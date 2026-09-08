import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("tenant-scoped reply idempotency", () => {
  const migration = readFileSync(
    "db/migrations/103_reply_idempotency_tenant_scope.sql",
    "utf8"
  );
  const capture = readFileSync("lib/reply-capture.ts", "utf8");
  const events = readFileSync("lib/domain/reply-outcome.ts", "utf8");
  const matching = readFileSync("lib/needs-matching.ts", "utf8");

  it("keys inbound communications by organization and provider message id", () => {
    expect(migration).toMatch(
      /communications\s*\(org_id, gmail_message_id\)/
    );
    expect(capture).toMatch(
      /on conflict \(org_id, gmail_message_id\)\s*where direction = 'inbound' and gmail_message_id is not null and org_id is not null/
    );
    expect(migration).toContain(
      "drop index if exists public.communications_inbound_message_uniq"
    );
  });

  it("keys reply events by organization and provider message id", () => {
    expect(migration).toMatch(
      /subcontractor_reply_events\s*\(org_id, gmail_message_id\)/
    );
    expect(events).toMatch(
      /on conflict \(org_id, gmail_message_id\)\s*where gmail_message_id is not null and org_id is not null/
    );
    expect(migration).toContain(
      "drop index if exists public.sub_reply_events_message_uniq"
    );
  });

  it("retains a separate guard for historical rows without an organization", () => {
    expect(migration).toContain("communications_inbound_message_legacy_uniq");
    expect(migration).toContain("sub_reply_events_message_legacy_uniq");
    expect(migration.match(/org_id is null/g)).toHaveLength(2);
  });

  it("keeps RFC threading data while a reply waits for manual matching", () => {
    expect(migration).toContain("add column if not exists rfc822_message_id text");
    expect(migration).toContain("add column if not exists rfc822_references jsonb");
    expect(migration).toContain("add column if not exists unreadable_attachments jsonb");
    expect(matching).toMatch(
      /rfc822MessageId: msg\.rfc822_message_id[\s\S]*references: Array\.isArray/
    );
    expect(matching).toMatch(
      /attachmentNames: Array\.isArray[\s\S]*unreadableAttachments: Array\.isArray/
    );
  });

  it("leases a manual match so duplicate tabs cannot run the pipeline twice", () => {
    expect(matching).toMatch(
      /set matched_by = \$3, matched_at = now\(\)[\s\S]*matched_at <= now\(\) - interval '15 minutes'[\s\S]*returning id/
    );
    expect(matching).toMatch(
      /state='needs_matching' and matched_by=\$6[\s\S]*returning id/
    );
  });
});
