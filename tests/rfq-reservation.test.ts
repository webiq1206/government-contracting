/**
 * Four outreach jobs at once must not all read "under the cap" and all send.
 *
 * The stand-in database only serializes work that takes the daily-slot lock.
 * A count that happens before that lock lets every caller see zero claims.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

interface Claim {
  id: string;
  orgId: string;
  opportunityId: string;
  subcontractorId: string;
  trade: string;
  state: string;
}

const state = vi.hoisted(() => ({
  claims: [] as Claim[],
  locked: false,
  waiters: [] as Array<() => void>,
}));

vi.mock("../lib/db", () => ({
  tenantTransaction: async (
    _orgId: string,
    fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
  ) => {
    let release: (() => void) | null = null;
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("for update")) {
          if (state.locked) await new Promise<void>((resolve) => state.waiters.push(resolve));
          state.locked = true;
          release = () => {
            const next = state.waiters.shift();
            if (next) next();
            else state.locked = false;
          };
          return { rows: [{ utc_day: "2026-10-17" }] };
        }
        if (sql.includes("as sent_today")) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          const orgId = String(params[0]);
          const opportunityId = String(params[1]);
          const trade = String(params[2]);
          const open = state.claims.filter((claim) => claim.orgId === orgId && claim.state !== "released");
          const sentForTrade = new Set(
            open
              .filter((claim) => claim.opportunityId === opportunityId && claim.trade === trade)
              .map((claim) => claim.subcontractorId)
          ).size;
          return { rows: [{ sent_today: open.length, sent_for_trade: sentForTrade }] };
        }
        if (sql.includes("insert into rfq_send_claims")) {
          const id = randomUUID();
          state.claims.push({
            id,
            orgId: String(params[0]),
            opportunityId: String(params[1]),
            subcontractorId: String(params[2]),
            trade: String(params[3]),
            state: "reserved",
          });
          return { rows: [{ id }] };
        }
        if (sql.includes("set state")) {
          const claim = state.claims.find((row) => row.id === params[1] && row.orgId === params[0] && row.state === "reserved");
          if (claim) claim.state = String(params[2]);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    try {
      return await fn(client);
    } finally {
      release?.();
    }
  },
}));

import { releaseRfqSendSlot, reserveRfqSendSlot, settleRfqSendSlot } from "../lib/domain/rfq-reservation";

async function overlap(cap: { dailyCap: number; perTradeCap: number }, count = 4) {
  const orgId = randomUUID();
  const opportunityId = randomUUID();
  const sent: string[] = [];
  await Promise.all(Array.from({ length: count }, async () => {
    const subcontractorId = randomUUID();
    const slot = await reserveRfqSendSlot({
      orgId,
      opportunityId,
      subcontractorId,
      trade: "HVAC",
      dailyCap: cap.dailyCap,
      perTradeCap: cap.perTradeCap,
    });
    if (!slot.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
    sent.push(subcontractorId);
    await settleRfqSendSlot(orgId, slot.claimId);
  }));
  return sent;
}

describe("quote-request slots", () => {
  beforeEach(() => {
    state.claims = [];
    state.locked = false;
    state.waiters = [];
  });

  it("stops four overlapping sends at a daily cap of 2", async () => {
    const sent = await overlap({ dailyCap: 2, perTradeCap: 5 });
    expect(sent).toHaveLength(2);
    expect(state.claims.filter((claim) => claim.state === "sent")).toHaveLength(2);
    expect(state.claims.filter((claim) => claim.state === "reserved")).toHaveLength(0);
  });

  it("stops four overlapping sends at one subcontractor per trade", async () => {
    const sent = await overlap({ dailyCap: 100, perTradeCap: 1 });
    expect(sent).toHaveLength(1);
  });

  it("frees a slot when the send does not happen", async () => {
    const orgId = randomUUID();
    const first = await reserveRfqSendSlot({
      orgId,
      opportunityId: randomUUID(),
      subcontractorId: randomUUID(),
      trade: "HVAC",
      dailyCap: 1,
      perTradeCap: 5,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await releaseRfqSendSlot(orgId, first.claimId);
    const second = await reserveRfqSendSlot({
      orgId,
      opportunityId: randomUUID(),
      subcontractorId: randomUUID(),
      trade: "HVAC",
      dailyCap: 1,
      perTradeCap: 5,
    });
    expect(second.ok).toBe(true);
  });
});
