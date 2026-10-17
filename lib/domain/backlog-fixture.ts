/**
 * Read-only stand-in for the stalled review backlog.
 *
 * These are fixture rows, not production records. The dry-run preview runs
 * the same classifier the sweep uses. Nothing here is written anywhere.
 */
import { addBusinessDays } from "./review-lead";
import type { BacklogRow } from "./backlog-disposition";

const STAGES = ["monitoring", "scoring", "analysis", "outreach", "quote_entry"] as const;

export function fixtureBacklog(now: Date): BacklogRow[] {
  const rows: BacklogRow[] = [];
  for (let i = 1; i <= 18; i++) {
    const deadline = new Date(now.getTime() - i * 86_400_000);
    rows.push({
      id: `fix-past-${String(i).padStart(2, "0")}`,
      title: `Fixture past deadline ${i}`,
      deadline: deadline.toISOString(),
      status: "open",
      tier: "review",
      stage: STAGES[(i - 1) % STAGES.length],
      riskFlags: i % 2 === 0 ? ["incomplete_scoring"] : [],
    });
  }
  for (let i = 1; i <= 12; i++) {
    const deadline = addBusinessDays(now, (i % 4) + 1);
    rows.push({
      id: `fix-soon-${String(i).padStart(2, "0")}`,
      title: `Fixture closing inside lead time ${i}`,
      deadline: new Date(deadline.getTime() - 60_000).toISOString(),
      status: "open",
      tier: i % 3 === 0 ? "pursue" : "review",
      stage: STAGES[(i - 1) % STAGES.length],
      riskFlags: i % 2 === 0 ? ["incomplete_scoring"] : [],
    });
  }
  for (let i = 1; i <= 8; i++) {
    rows.push({
      id: `fix-far-${String(i).padStart(2, "0")}`,
      title: `Fixture incomplete score ${i}`,
      deadline: addBusinessDays(now, 10 + i).toISOString(),
      status: "open",
      tier: "review",
      stage: i % 2 === 0 ? "scoring" : "monitoring",
      riskFlags: ["incomplete_scoring"],
    });
  }
  for (const [i, stage] of ["bid_building", "submitted", "bid_building", "won"].entries()) {
    rows.push({
      id: `fix-protected-${i + 1}`,
      title: `Fixture already in ${stage}`,
      deadline: new Date(now.getTime() - 86_400_000).toISOString(),
      status: "open",
      tier: "pursue",
      stage,
      riskFlags: ["incomplete_scoring"],
    });
  }
  for (let i = 1; i <= 4; i++) {
    rows.push({
      id: `fix-scored-${i}`,
      title: `Fixture finished review score ${i}`,
      deadline: addBusinessDays(now, 15).toISOString(),
      status: "open",
      tier: "review",
      stage: "scoring",
      riskFlags: [],
    });
  }
  return rows;
}
