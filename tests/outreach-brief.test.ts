import { describe, it, expect } from "vitest";
import {
  buildOutreachBrief,
  describeMissing,
  type OutreachBriefInput,
} from "@/lib/domain/outreach-brief";
import { renderOutreachBrief } from "@/lib/domain/outreach-email";

/** A complete, sendable request. Tests remove pieces from this. */
function input(overrides: Partial<OutreachBriefInput> = {}): OutreachBriefInput {
  return {
    trade: "HVAC",
    title: "Chiller replacement, Building 400",
    agency: "Robins AFB",
    solicitationNumber: "FA8501-26-R-0042",
    locationText: "Warner Robins",
    locationState: "GA",
    deadlineLabel: "Sep 18, 2026",
    description: "Replace the primary chiller.",
    analysis: {
      trade_scopes: [
        {
          trade: "HVAC",
          work:
            "Remove the existing 400-ton chiller\n" +
            "Set the new unit on the existing pad\n" +
            "Tie into building controls and commission",
        },
      ],
      special_requirements: ["Davis-Bacon wage rates apply to all site labor"],
      key_dates: [{ label: "Questions due", date: "Sep 4, 2026" }],
      site_visit: { required: true, details: "Sep 8, 9am, main gate" },
      questions_for_subs: ["Can you work around the chiller staying live?"],
    },
    attachedNames: ["SOW.pdf"],
    links: [],
    documentsExpected: true,
    ...overrides,
  };
}

function headings(b: ReturnType<typeof buildOutreachBrief>): string[] {
  return b.sections.map((s) => s.heading);
}

describe("buildOutreachBrief", () => {
  it("covers everything a subcontractor needs to price the work", () => {
    const b = buildOutreachBrief(input());
    expect(b.ready).toBe(true);
    expect(headings(b)).toEqual([
      "Project",
      "Scope we need priced",
      "Schedule",
      "What to send back",
      "Worth knowing",
      "Documents",
    ]);
  });

  it("names the project, its location, agency and solicitation", () => {
    const items = buildOutreachBrief(input()).sections[0].items.join("\n");
    expect(items).toMatch(/Project: Chiller replacement/);
    expect(items).toMatch(/Location: Warner Robins, GA/);
    expect(items).toMatch(/Agency: Robins AFB/);
    expect(items).toMatch(/Solicitation: FA8501/);
  });

  it("breaks the trade scope into one line per task", () => {
    const scope = buildOutreachBrief(input()).sections.find(
      (s) => s.heading === "Scope we need priced"
    )!;
    expect(scope.items).toHaveLength(3);
    expect(scope.items[0]).toMatch(/^Remove the existing 400-ton chiller$/);
  });

  it("carries the bid date, key dates and a required site visit", () => {
    const sched = buildOutreachBrief(input()).sections.find(
      (s) => s.heading === "Schedule"
    )!;
    expect(sched.items[0]).toMatch(/due Sep 18, 2026/);
    expect(sched.items.join("\n")).toMatch(/Questions due: Sep 4/);
    expect(sched.items.join("\n")).toMatch(/Site visit: Sep 8/);
  });

  it("always spells out what to send back", () => {
    // The instructions are fixed on purpose: vagueness here is what produces
    // the follow-up questions this email exists to prevent.
    const back = buildOutreachBrief(input({ analysis: null })).sections.find(
      (s) => s.heading === "What to send back"
    )!;
    expect(back.items.join(" ")).toMatch(/price/i);
    expect(back.items.join(" ")).toMatch(/payment terms/i);
    expect(back.items.join(" ")).toMatch(/exclud/i);
  });

  it("lists attachments and links as documents", () => {
    const b = buildOutreachBrief(
      input({ attachedNames: ["SOW.pdf"], links: [{ name: "Drawings", url: "https://x.test/d" }] })
    );
    const docs = b.sections.find((s) => s.heading === "Documents")!;
    expect(docs.items).toEqual(["SOW.pdf (attached)", "Drawings: https://x.test/d"]);
  });

  it("drops a section entirely rather than showing an empty heading", () => {
    const b = buildOutreachBrief(
      input({ analysis: { trade_scopes: [{ trade: "HVAC", work: "Replace 2 units" }] } })
    );
    expect(headings(b)).not.toContain("Worth knowing");
  });
});

describe("the completeness gate", () => {
  it("blocks when there is no usable scope", () => {
    const b = buildOutreachBrief(
      input({ analysis: null, description: null })
    );
    expect(b.ready).toBe(false);
    expect(b.missing.some((m) => m.key === "scope" && m.blocking)).toBe(true);
  });

  it("blocks when the project has no name", () => {
    const b = buildOutreachBrief(input({ title: null }));
    expect(b.ready).toBe(false);
    expect(b.missing.some((m) => m.key === "project_name")).toBe(true);
  });

  it("blocks when there is nowhere to perform the work", () => {
    const b = buildOutreachBrief(
      input({ locationText: null, locationState: null, analysis: { ...input().analysis, location: null } })
    );
    expect(b.ready).toBe(false);
    expect(b.missing.some((m) => m.key === "location")).toBe(true);
  });

  it("blocks when no bid date can be given", () => {
    const b = buildOutreachBrief(input({ deadlineLabel: null }));
    expect(b.ready).toBe(false);
    expect(b.missing.some((m) => m.key === "deadline")).toBe(true);
  });

  it("blocks when documents exist but none could be included", () => {
    const b = buildOutreachBrief(
      input({ attachedNames: [], links: [], documentsExpected: true })
    );
    expect(b.ready).toBe(false);
    expect(b.missing.some((m) => m.key === "documents")).toBe(true);
  });

  it("sends when the solicitation genuinely has no documents", () => {
    const b = buildOutreachBrief(
      input({ attachedNames: [], links: [], documentsExpected: false })
    );
    expect(b.ready).toBe(true);
  });

  it("notes an unquantified scope without blocking on it", () => {
    // Plenty of real scopes are qualitative; the operator should know the
    // price coming back is a guess, not be stopped from asking for one.
    const b = buildOutreachBrief(
      input({
        analysis: {
          trade_scopes: [{ trade: "HVAC", work: "Service the air handling equipment as needed" }],
        },
      })
    );
    expect(b.ready).toBe(true);
    expect(b.missing.some((m) => m.key === "quantities" && !m.blocking)).toBe(true);
  });

  it("explains every blocking problem in one line for the operator", () => {
    const b = buildOutreachBrief(input({ title: null, deadlineLabel: null }));
    const why = describeMissing(b.missing);
    expect(why).toMatch(/project name/i);
    expect(why).toMatch(/deadline/i);
  });
});

describe("renderOutreachBrief", () => {
  it("renders headings and bullets in both plain text and HTML", () => {
    const b = buildOutreachBrief(input());
    const { plain, html } = renderOutreachBrief(b.sections);
    expect(plain).toMatch(/PROJECT\n- Project: Chiller/);
    expect(plain).toMatch(/WHAT TO SEND BACK\n- Your lump-sum price/);
    expect(html).toMatch(/<p[^>]*>Project<\/p><ul/);
    expect(html.match(/<li/g)!.length).toBeGreaterThan(10);
  });

  it("makes document URLs clickable without mangling the rest", () => {
    const { html } = renderOutreachBrief([
      { heading: "Documents", items: ["Drawings: https://x.test/d"] },
    ]);
    expect(html).toContain('<a href="https://x.test/d">https://x.test/d</a>');
  });

  it("renders nothing at all when every section is empty", () => {
    expect(renderOutreachBrief([{ heading: "Project", items: [] }])).toEqual({
      plain: "",
      html: "",
    });
  });
});
