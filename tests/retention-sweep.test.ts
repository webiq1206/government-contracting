import { describe, it, expect } from "vitest";

/**
 * Pure logic tests for the retention sweep eligibility and blob-cleanup rules.
 * These tests mirror the SQL predicates and sweep guard logic so that any
 * loosening of a safeguard breaks a test rather than silently deleting real
 * business records.
 *
 * The actual DB-level sweep is integration-tested via the maintenance agent
 * handler; these unit tests cover the decision logic in isolation.
 */

// ── Retention eligibility (mirrors retentionSweep SQL WHERE clause) ────────

interface OppCandidate {
  status: string;
  /** Days old — used as proxy for deadline/updated_at age. */
  ageDays: number;
  retentionDays: number;
  hasBid: boolean;
  hasContract: boolean;
  hasQuote: boolean;
}

/** Returns true when the opportunity should be included in the purge batch. */
function isRetentionEligible(c: OppCandidate): boolean {
  if (c.retentionDays <= 0) return false;           // sweep is disabled
  if (c.status !== "archived") return false;         // only archived records
  if (c.ageDays <= c.retentionDays) return false;   // within window or at exact boundary (SQL uses strict <)
  if (c.hasBid) return false;                        // business record
  if (c.hasContract) return false;                   // business record
  if (c.hasQuote) return false;                      // operator worked this
  return true;
}

function base(over: Partial<OppCandidate> = {}): OppCandidate {
  return {
    status: "archived",
    ageDays: 45,
    retentionDays: 30,
    hasBid: false,
    hasContract: false,
    hasQuote: false,
    ...over,
  };
}

describe("retention sweep eligibility", () => {
  it("selects a plain stale archived record", () => {
    expect(isRetentionEligible(base())).toBe(true);
  });

  it("skips when sweep is disabled (retention_days = 0)", () => {
    expect(isRetentionEligible(base({ retentionDays: 0 }))).toBe(false);
  });

  it("skips records still inside the retention window", () => {
    expect(isRetentionEligible(base({ ageDays: 20, retentionDays: 30 }))).toBe(false);
    // exactly at the boundary is also excluded
    expect(isRetentionEligible(base({ ageDays: 30, retentionDays: 30 }))).toBe(false);
  });

  it("NEVER deletes a record that has a bid", () => {
    expect(isRetentionEligible(base({ hasBid: true }))).toBe(false);
  });

  it("NEVER deletes a record that has a contract", () => {
    expect(isRetentionEligible(base({ hasContract: true }))).toBe(false);
  });

  it("NEVER deletes a record that has a sub quote", () => {
    expect(isRetentionEligible(base({ hasQuote: true }))).toBe(false);
  });

  it("skips non-archived records regardless of age", () => {
    for (const status of ["open", "monitoring", "submitted", "won", "lost"]) {
      expect(isRetentionEligible(base({ status })), `status=${status}`).toBe(false);
    }
  });

  it("uses the configured window, not a hard-coded value", () => {
    // 90-day window: a 45-day-old record is still inside it
    expect(isRetentionEligible(base({ retentionDays: 90, ageDays: 45 }))).toBe(false);
    // 90-day window: a 100-day-old record is past it
    expect(isRetentionEligible(base({ retentionDays: 90, ageDays: 100 }))).toBe(true);
  });
});

// ── Blob deletion safety (mirrors the "no remaining document reference" guard) ─

interface BlobDeleteCandidate {
  path: string;
  /** True when at least one document still references this path (from a
   *  different opportunity that was NOT deleted). */
  hasOtherDocumentReference: boolean;
}

/** Returns true when the blob should be deleted after opportunity cascade. */
function isBlobOrphaned(b: BlobDeleteCandidate): boolean {
  return !b.hasOtherDocumentReference;
}

describe("file_blob orphan detection after cascade", () => {
  it("deletes a blob with no remaining document references", () => {
    expect(isBlobOrphaned({ path: "opps/abc/sow.pdf", hasOtherDocumentReference: false })).toBe(true);
  });

  it("NEVER deletes a blob still referenced by another document", () => {
    // This covers the shared-path scenario where two opportunities share the
    // same uploaded file (e.g. a template or a shared SOW).
    expect(isBlobOrphaned({ path: "shared/template.pdf", hasOtherDocumentReference: true })).toBe(false);
  });

  it("each path is evaluated independently", () => {
    const paths: BlobDeleteCandidate[] = [
      { path: "opps/1/sow.pdf", hasOtherDocumentReference: false }, // delete
      { path: "shared/cap.pdf", hasOtherDocumentReference: true },  // keep
      { path: "opps/2/rfp.pdf", hasOtherDocumentReference: false }, // delete
    ];
    const toDelete = paths.filter(isBlobOrphaned).map((b) => b.path);
    expect(toDelete).toEqual(["opps/1/sow.pdf", "opps/2/rfp.pdf"]);
    expect(toDelete).not.toContain("shared/cap.pdf");
  });
});

// ── Default retention value ───────────────────────────────────────────────────

import { DEFAULT_RULES } from "../lib/domain/intake";

describe("DEFAULT_RULES.retention_days", () => {
  it("defaults to 30 days so cleanup runs without manual configuration", () => {
    expect(DEFAULT_RULES.retention_days).toBe(30);
  });

  it("is positive so the sweep is active by default (not 0 = keep forever)", () => {
    expect(DEFAULT_RULES.retention_days).toBeGreaterThan(0);
  });
});
