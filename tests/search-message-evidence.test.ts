import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query }));
import { searchEverything } from "@/lib/search";

beforeEach(() => { query.mockReset(); });
describe("search message outcomes come from recorded evidence", () => {
  it.each([
    ["draft", null, "Draft, not sent"], ["held", null, "Held, not sent"],
    ["failed", null, "Never sent"], ["queued", null, "Queued, not attempted"],
    ["attempting", "gmail", "Attempt recorded, outcome unconfirmed"],
    ["unknown", "gmail", "Delivery uncertain"], ["sent", null, "Delivery uncertain"],
    ["sent", "gmail", "Sent, no confirmation yet"], ["delivered", "gmail", "Delivered"],
  ])("shows %s with provider %s as %s", async (state, provider, expected) => {
    query.mockImplementation(async (sql: string) => sql.includes("from communications c") ? [{
      id: "synthetic-message", subject: "Synthetic Sources Sought response", body: "",
      direction: "outbound", channel: "email", delivery_state: state, provider,
      delivery_detail: null, opened_at: null, clicked_at: null, replied_at: null,
      company_name: null,
    }] : []);
    const results = await searchEverything("Synthetic", "synthetic-org");
    expect(results).toHaveLength(1);
    expect(results[0].subtitle).toBe(expected);
    expect(query.mock.calls.every(([, args]) => args.includes("synthetic-org"))).toBe(true);
    const messageSql = query.mock.calls.find(([sql]) => sql.includes("from communications c"))?.[0];
    expect(messageSql).toContain("c.delivery_state");
    expect(messageSql).toContain("c.provider");
  });
  it("does not describe an outgoing call as a sent email", async () => {
    query.mockImplementation(async (sql: string) => sql.includes("from communications c") ? [{
      id: "synthetic-call", subject: "Call note", body: "", direction: "outbound", channel: "phone",
    }] : []);
    expect((await searchEverything("Call", "synthetic-org"))[0].subtitle).toBe("Call recorded");
  });
});
