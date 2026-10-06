import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItem } from "@/lib/domain/work-queue";
const { opportunityDetail } = vi.hoisted(() => ({ opportunityDetail: vi.fn() }));
vi.mock("@/lib/data", () => ({ opportunityDetail }));
vi.mock("@/lib/db", () => ({ queryOne: vi.fn() }));
import { loadWorkbenchDetail } from "@/lib/workbench";

const item = { kind: "decide", opportunityId: "synthetic-opportunity" } as WorkItem;
const openReview = { status: "open", stage: "scoring", tier: "review", human_action_required: true,
  pursuit_state: "active", is_sources_sought: false,
  review_expires_at: "2020-01-01T00:00:00Z", deadline: "2020-01-02T00:00:00Z" };
beforeEach(() => { opportunityDetail.mockReset(); });
function record(overrides = {}) {
  opportunityDetail.mockResolvedValue({ opp: { ...openReview, ...overrides }, documents: [], quotes: [], subs: [] });
}
describe("fresh record state before showing review decisions", () => {
  it.each([
    { status: "archived" }, { stage: "dismissed" }, { stage: "analysis" },
    { tier: "pursue" }, { human_action_required: false }, { pursuit_state: "aborted" },
    { pursuit_state: "paused" }, { is_sources_sought: true },
    { snoozed_until: "2999-01-01T00:00:00Z" },
  ])("removes decision controls after the queued record changes: %j", async (overrides) => {
    record(overrides);
    expect((await loadWorkbenchDetail(item, "synthetic-org")).pane).toBe("gone");
  });
  it("does not invent dismissal from an overdue timer or bid deadline", async () => {
    record();
    expect((await loadWorkbenchDetail(item, "synthetic-org")).pane).toBe("decide");
  });
  it("allows a decision after the snooze has elapsed", async () => {
    record({ snoozed_until: "2020-01-01T00:00:00Z" });
    expect((await loadWorkbenchDetail(item, "synthetic-org")).pane).toBe("decide");
  });
});
