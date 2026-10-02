import { describe, expect, it } from "vitest";
import { attachmentReadingCoverage, extractionStateFor } from "../lib/domain/attachment-reading";
import { assembleAttachmentContext } from "../lib/domain/extraction-budget";
import type { AttachmentFetchStatus } from "../lib/domain/solicitation-completeness";
const outcomes = (status: AttachmentFetchStatus, count: number) => Array.from({ length: count }, (_, i) => ({name: `${status}-${i}`, status}));
describe("analyst reading coverage", () => {
  it("does not count fitted failure descriptions as read documents", () => {
    const rows = [...outcomes("fetched",16), ...outcomes("unsupported",4), ...outcomes("no_text",2)];
    const { plan } = assembleAttachmentContext(rows.map(row => ({name:row.name,context:`${row.name}: extraction outcome ${row.status}`})),240000);
    expect(plan.complete).toBe(true);
    const coverage = attachmentReadingCoverage(rows);
    expect(coverage.complete).toBe(false);
    expect(coverage.summary).toBe("16 of 22 document(s) read in full; 4 stored but not read, 2 unreadable.");
  });
  it("uses the same extraction states for persistence and activity", () => {
    expect(extractionStateFor("fetched",true)).toBe("partial");
    expect(extractionStateFor("unsupported",false)).toBe("not_read");
    expect(extractionStateFor("no_text",false)).toBe("unreadable");
    const coverage=attachmentReadingCoverage([...outcomes("partial",1),...outcomes("not_read",1),...outcomes("failed",1)]);
    expect(coverage.complete).toBe(false); expect(coverage.read).toBe(0);
    expect(coverage.partial).toBe(1); expect(coverage.notRead).toBe(1); expect(coverage.blocked).toBe(1);
  });
  it("accounts for a fully read packet and does not claim an empty one is complete", () => {
    expect(attachmentReadingCoverage(outcomes("fetched",2)).complete).toBe(true);
    expect(attachmentReadingCoverage([]).complete).toBe(false);
  });
});
