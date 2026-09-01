import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The automation log stored the evidence and rendered the summary.
 *
 * `agent_logs` has carried `input_json`, `output_json`, `opportunity_id`,
 * `subcontractor_id` and `bid_id` since it was created. The page showed agent,
 * level, action, message and reasoning, so the one screen somebody opens when
 * something is broken was withholding the request that failed, the response
 * that came back, and the record it happened to.
 *
 * Checked in source because the failure is an absence: no assertion about what
 * the page renders can fail when the column is simply never selected.
 */
const DATA = readFileSync("lib/data.ts", "utf8");
const PEEK = readFileSync("components/agent-run-peek.tsx", "utf8");
const PAGE = readFileSync("app/(dash)/agents/page.tsx", "utf8");

describe("the run detail", () => {
  it("selects the payloads the list query deliberately leaves out", () => {
    const loader = DATA.slice(DATA.indexOf("export async function agentRun("));
    expect(loader).toContain("l.input_json");
    expect(loader).toContain("l.output_json");
  });

  it("resolves every record id to something a person can read", () => {
    const loader = DATA.slice(DATA.indexOf("export async function agentRun("));
    // A run that says it failed on `a3f2...` is a run nobody can act on.
    expect(loader).toContain("o.title as opportunity_title");
    expect(loader).toContain("s.company_name as subcontractor_name");
    expect(loader).toContain("b.opportunity_id as bid_opportunity_id");
  });

  it("stays scoped to the organization looking at it", () => {
    const loader = DATA.slice(DATA.indexOf("export async function agentRun("));
    expect(loader).toContain("l.org_id = $2");
    expect(loader).toContain("await currentOrg()");
  });

  it("refuses an id that is not a uuid before it reaches the query", () => {
    const loader = DATA.slice(DATA.indexOf("export async function agentRun("));
    expect(loader).toContain("if (!/^[0-9a-f-]{36}$/i.test(id)) return null;");
  });

  it("keeps the payloads out of the list query, which draws fifty rows", () => {
    const list = DATA.slice(
      DATA.indexOf("export async function agentLogsPaged("),
      DATA.indexOf("export const LOG_PAGE_SIZE")
    );
    expect(list).not.toContain("input_json");
    expect(list).not.toContain("output_json");
  });

  it("renders both payloads and the records the run touched", () => {
    expect(PEEK).toContain("What it was given");
    expect(PEEK).toContain("What it returned");
    expect(PEEK).toContain("What it ran on");
  });

  it("collapses the payloads, so the drawer does not open onto a wall of JSON", () => {
    expect(PEEK).toContain("<details>");
  });

  it("opens from a log row without leaving the filters or the page", () => {
    expect(PAGE).toContain("const openRunId = searchParams?.run ?? null;");
    expect(PAGE).toContain("runHref(str(log.id))");
  });
});
