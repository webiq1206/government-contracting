/**
 * Every sortable column on the two big tables, actually executed.
 *
 * The bug this guards against shipped and stayed: the sort whitelists stored
 * `"deadline nulls last"` as the column, and the query builder appended the
 * direction, producing `order by deadline nulls last asc`. Postgres accepts
 * `expr [asc|desc] [nulls first|last]` in that order and nothing else, so this
 * was error 42601 -- and because the throw happened inside a server component,
 * the operator did not see an error message. They saw the page's error
 * boundary: no heading, no table, no explanation. Six of the fourteen sortable
 * columns across the two tables were dead, Deadline on the opportunities table
 * among them, which is the first column anybody running a bid pipeline clicks.
 *
 * Nothing caught it. The unit tests exercised `parseSort`, which was correct;
 * the source-scanning tests read the SQL without running it; and no test ever
 * asked the database to accept the string that was actually built.
 *
 * So this test builds it and runs it, for every key in both directions. A
 * malformed ORDER BY is a thrown error, which means the assertion is simply
 * that the call returns -- there is no way to write this test so that it
 * passes vacuously, because a syntax error cannot be silent.
 *
 * The structural half below is the cheap sibling: it fails at the point
 * somebody writes a direction or a NULLS clause back into a whitelist entry,
 * which is where the mistake was made rather than where it surfaced.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "crypto";
import type { SessionUser } from "../lib/auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: vi.fn(async () => CURRENT) };
});
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

describe("sort whitelists hold columns, not clauses", () => {
  it("no entry carries a direction or a NULLS clause in its SQL", async () => {
    const { OPP_SORTS, SUB_SORTS } = await import("../lib/data");
    const entries = [
      ...Object.entries(OPP_SORTS).map(([k, v]) => [`OPP_SORTS.${k}`, v] as const),
      ...Object.entries(SUB_SORTS).map(([k, v]) => [`SUB_SORTS.${k}`, v] as const),
    ];
    expect(entries.length).toBeGreaterThan(10);
    for (const [name, col] of entries) {
      expect(
        /\b(asc|desc|nulls)\b/i.test(col.sql),
        `${name} sql is "${col.sql}"; a direction or NULLS clause here is appended after the direction and is a syntax error. Use the nullsLast flag.`
      ).toBe(false);
    }
  });

  it("composes the clause in the order the grammar requires", async () => {
    const { sortTerm } = await import("../lib/domain/table-view");
    expect(sortTerm({ sql: "deadline", nullsLast: true }, "asc")).toBe(
      "deadline asc nulls last"
    );
    expect(sortTerm({ sql: "deadline", nullsLast: true }, "desc")).toBe(
      "deadline desc nulls last"
    );
    expect(sortTerm({ sql: "title" }, "desc")).toBe("title desc");
  });
});

d("every sortable column executes (integration)", () => {
  const org = { id: "" };
  let opportunityTable: typeof import("../lib/data").opportunityTable;
  let subDatabase: typeof import("../lib/data").subDatabase;
  let OPP_SORTS: typeof import("../lib/data").OPP_SORTS;
  let SUB_SORTS: typeof import("../lib/data").SUB_SORTS;

  beforeAll(async () => {
    const { queryOne, query } = await import("../lib/db");
    ({ opportunityTable, subDatabase, OPP_SORTS, SUB_SORTS } = await import("../lib/data"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`sorts-${randomUUID()}`]
    );
    org.id = o!.id;

    /*
     * Two rows per table, one of them with the nullable columns left null.
     * A single row, or two full ones, would order identically whatever the
     * clause said; the null is the case the NULLS position exists for.
     */
    await query(
      `insert into opportunities (org_id, source, title, stage, status, agency, deadline, location_state, score, value_estimated)
       values ($1,'test','Deadlined job','bid_building','open','GSA', now() + interval '10 days','TX',80,50000),
              ($1,'test','Undated job','bid_building','open', null, null, null, null, null)`,
      [org.id]
    );
    await query(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email, email_verified, reliability_score, google_rating, last_contacted, license_status)
       values ($1,'Rivera Mechanical',$2,'TX','r@x.invalid',true,70,4.5, now(),'active'),
              ($1,'Blank Records',$2, null,'b@x.invalid',true, null, null, null, null)`,
      [org.id, ["hvac"]]
    );

    CURRENT = {
      id: randomUUID(), email: "op@x.invalid", name: "Op", role: "member",
      orgRole: "owner",
      organizationId: org.id, subscriptionStatus: "active", planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  });

  it("sorts the opportunities table by every whitelisted column", async () => {
    const keys = Object.keys(OPP_SORTS);
    expect(keys.length).toBeGreaterThan(0);
    for (const sort of keys) {
      for (const direction of ["asc", "desc"] as const) {
        const rows = await opportunityTable({}, { sort, direction, limit: 10, offset: 0 });
        expect(rows.length, `${sort} ${direction}`).toBe(2);
      }
    }
  });

  it("sorts the roster by every whitelisted column", async () => {
    const keys = Object.keys(SUB_SORTS);
    expect(keys.length).toBeGreaterThan(0);
    for (const sort of keys) {
      for (const direction of ["asc", "desc"] as const) {
        const rows = await subDatabase({}, { sort, direction, limit: 10, offset: 0 });
        expect(rows.length, `${sort} ${direction}`).toBe(2);
      }
    }
  });

  it("puts blanks last whichever way a nullable column is sorted", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const rows = await subDatabase({}, { sort: "state", direction, limit: 10, offset: 0 });
      expect(rows[rows.length - 1].company_name, `state ${direction}`).toBe("Blank Records");
    }
  });
});
