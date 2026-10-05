import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/lib/db", () => ({ query: async (sql: string, args: unknown[]) => (await state.db.query(sql,args)).rows }));
vi.mock("@/lib/tenant", () => ({ resolveTenantOrgId: async () => "ours" }));
vi.mock("@/lib/sub-compliance-store", () => ({ loadAwardCompliance: vi.fn(), needsAttentionOnWonWork: vi.fn() }));
vi.mock("@/lib/worker-heartbeat", () => ({ readWorkerHeartbeat: vi.fn() }));
import { templateSendStats } from "@/lib/data";

it("counts actual sent mail separately from drafts and delivery signals", async () => {
  state.db = new PGlite();
  try {
    await state.db.exec(`create table communications(org_id text,channel text,direction text,provider text,delivery_state text,meta jsonb,opened_at timestamptz,clicked_at timestamptz,replied_at timestamptz,created_at timestamptz default now());
      insert into communications(org_id,channel,direction,provider,delivery_state,opened_at)
      values ('ours','email','outbound',null,'draft',null),('ours','email','outbound','gmail','failed',null),
        ('ours','email','outbound','gmail','sent',now()),('ours','email','outbound','gmail','delivered',null),
        ('ours','email','outbound','gmail','bounced',null),('other','email','outbound','gmail','delivered',null);`);
    expect((await templateSendStats()).template_1_outreach).toMatchObject({ sent: 3, delivered: 1, opened: 1, bounced: 1 });
  } finally { await state.db.close(); }
}, 30_000);
