import { describe, expect, it } from "vitest";
import { classifyBacklog } from "@/lib/domain/backlog-disposition";
import { fixtureBacklog } from "@/lib/domain/backlog-fixture";

const NOW = new Date("2026-10-16T17:11:00.000Z");

describe("backlog dry-run preview", () => {
  const rows = classifyBacklog(fixtureBacklog(NOW), NOW, 5);
  const archive = rows.filter((row) => row.action === "archive");
  const requeue = rows.filter((row) => row.action === "requeue");

  it("covers the stalled-backlog shape without writing anything", () => {
    expect(rows).toHaveLength(46);
    expect(archive).toHaveLength(30);
    expect(requeue).toHaveLength(8);
    expect(rows.filter((row) => row.action === "keep")).toHaveLength(8);
    expect(archive.every((row) => row.reason.startsWith("auto-pass: deadline"))).toBe(true);
    expect(requeue.every((row) => row.reason.includes("incomplete scoring"))).toBe(true);
    expect(rows.filter((row) => row.id.startsWith("fix-protected-")).every((row) => row.action === "keep")).toBe(true);
  });

  it("names each fixture row", () => {
    for (const row of rows) {
      expect(row.id).toBeTruthy();
      expect(row.title).toBeTruthy();
      expect(row.deadline).toBeTruthy();
      expect(row.reason.length).toBeGreaterThan(10);
    }
  });
});
