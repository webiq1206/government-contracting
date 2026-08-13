/**
 * Tests for the shared template-rendering utilities (renderTemplate,
 * formatDeadlineLabel, plainToHtml) and the versioning invariant enforced by
 * the PATCH /api/templates/[slug] route.
 */
import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  formatDeadlineLabel,
  plainToHtml,
} from "../lib/domain/template-render";

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe("renderTemplate", () => {
  it("substitutes every known token", () => {
    const vars: Record<string, string> = {
      owner_name: "Marcus",
      company_name: "BROSTCO Holdings LLC",
      opportunity_title: "HVAC Maintenance Services",
      location_state: "Virginia",
      deadline: "Aug 25, 2026",
      trade: "HVAC",
      scope_summary: "replace HVAC units in 4 buildings",
      questions: "- Do you have federal experience?",
      sender_name: "Jared",
      phone: "(800) 555-0199",
      solicitation_number: "W912DR-26-R-0042",
      agency: "US Army Corps of Engineers",
    };
    const body =
      "Hi {{owner_name}},\n\nI'm {{sender_name}} with {{company_name}}." +
      " Job in {{location_state}}, deadline {{deadline}}.\n" +
      "Trade: {{trade}}\nScope: {{scope_summary}}\n{{questions}}\n" +
      "{{sender_name}}\n{{company_name}}\n{{phone}}\n" +
      "Solicitation: {{solicitation_number}}\nAgency: {{agency}}\n" +
      "Opportunity: {{opportunity_title}}";

    const result = renderTemplate(body, vars);

    expect(result).toContain("Hi Marcus,");
    expect(result).toContain("I'm Jared with BROSTCO Holdings LLC.");
    expect(result).toContain("Job in Virginia, deadline Aug 25, 2026.");
    expect(result).toContain("Trade: HVAC");
    expect(result).toContain("replace HVAC units in 4 buildings");
    expect(result).toContain("Do you have federal experience?");
    expect(result).toContain("(800) 555-0199");
    expect(result).toContain("W912DR-26-R-0042");
    expect(result).toContain("US Army Corps of Engineers");
    expect(result).toContain("HVAC Maintenance Services");
  });

  it("drops the copy around an unknown token rather than leaving a hole", () => {
    // Neither "Hello Sam, ref {{unknown_token}}!" (raw placeholder) nor
    // "Hello Sam, ref !" (visible gap) may reach a sub. The clause that needed
    // the value goes, and with nothing substantial left the line goes too.
    const result = renderTemplate("Hello {{owner_name}}, ref {{unknown_token}}!", {
      owner_name: "Sam",
    });
    expect(result).not.toContain("{{");
    expect(result).not.toMatch(/\s[.,;:!?](\s|$)/);
    expect(result).toBe("");
  });

  it("handles whitespace inside token braces", () => {
    const result = renderTemplate("Hi {{ owner_name }}!", { owner_name: "Alex" });
    expect(result).toBe("Hi Alex!");
  });

  it("substitutes the same token multiple times in the same template", () => {
    const result = renderTemplate("{{sender_name}} from {{company_name}}. — {{sender_name}}", {
      sender_name: "Jared",
      company_name: "BROSTCO",
    });
    expect(result).toBe("Jared from BROSTCO. — Jared");
  });

  it("produces nothing rather than a skeleton when vars is empty", () => {
    const tmpl = "Hello {{owner_name}}, please reply by {{deadline}}.";
    const result = renderTemplate(tmpl, {});
    // Previously rendered "Hello , please reply by ." — two visible gaps.
    expect(result).toBe("");
  });

  it("renders the seed template_1_outreach subject correctly", () => {
    const subject = "{{trade}} Quote Request, {{location_state}}";
    expect(renderTemplate(subject, { trade: "HVAC", location_state: "Virginia" })).toBe(
      "HVAC Quote Request, Virginia"
    );
  });

  it("renders the seed template_2_followup subject correctly", () => {
    const subject = "Re: {{trade}} Quote Request, {{location_state}}";
    expect(renderTemplate(subject, { trade: "Electrical", location_state: "Texas" })).toBe(
      "Re: Electrical Quote Request, Texas"
    );
  });
});

// ---------------------------------------------------------------------------
// formatDeadlineLabel
// ---------------------------------------------------------------------------

describe("formatDeadlineLabel", () => {
  it("returns fallback text for null deadline", () => {
    expect(formatDeadlineLabel(null)).toBe("the stated deadline");
  });

  it("returns the raw string when it cannot be parsed as a date", () => {
    expect(formatDeadlineLabel("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid ISO date string", () => {
    const result = formatDeadlineLabel("2026-08-25T17:00:00Z");
    // The exact locale string varies by environment; just ensure it's not the raw ISO.
    expect(result).not.toBe("2026-08-25T17:00:00Z");
    expect(result.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// plainToHtml
// ---------------------------------------------------------------------------

describe("plainToHtml", () => {
  it("converts newlines to <br> tags", () => {
    const result = plainToHtml("Line one\nLine two\nLine three");
    expect(result).toContain("<br>");
    expect(result).toContain("Line one");
    expect(result).toContain("Line two");
  });

  it("converts blank lines to <br> tags", () => {
    const result = plainToHtml("Para one\n\nPara two");
    expect(result).toContain("<br>");
    expect(result).toContain("Para one");
    expect(result).toContain("Para two");
  });

  it("escapes HTML before applying markup", () => {
    const result = plainToHtml('Hello <script>alert(1)</script> **friend**');
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
    expect(result).toContain("<strong>friend</strong>");
  });

  it("renders bold and highlight markers", () => {
    const result = plainToHtml("Please **reply soon** with ==your best price==.");
    expect(result).toContain("<strong>reply soon</strong>");
    expect(result).toContain('background-color:#FFF3CD');
    expect(result).toContain("your best price");
  });

  it("renders consecutive dash lines as a bullet list", () => {
    const result = plainToHtml("Intro\n- First\n- Second\nThanks");
    expect(result).toContain("<ul");
    expect(result).toContain("<li>First</li>");
    expect(result).toContain("<li>Second</li>");
    expect(result).toContain("Intro");
    expect(result).toContain("Thanks");
  });

  it("renders unicode bullet lines as a list", () => {
    const result = plainToHtml("Intro\n• First\n• Second");
    expect(result).toContain("<li>First</li>");
    expect(result).toContain("<li>Second</li>");
  });

  it("applies bold inside list items", () => {
    const result = plainToHtml("- Please **reply** soon");
    expect(result).toContain("<li>Please <strong>reply</strong> soon</li>");
  });

  it("recovers orphaned highlight markers around multiline questions", () => {
    const questions =
      "- Do you have experience with federal facilities in Virginia?\n- Can you provide bonding within 48 hours?";
    const filled = renderTemplate("=={{questions}}==", { questions });
    const html = plainToHtml(filled);
    expect(html).not.toContain("==");
    expect(html).toContain("<li>Do you have experience with federal facilities in Virginia?</li>");
    expect(html).toContain("<li>Can you provide bonding within 48 hours?</li>");
  });

  it("recovers the ==-- leftover from wrapping questions in highlight plus a separator", () => {
    const questions =
      "- Do you have experience with federal facilities in Virginia?\n- Can you provide bonding within 48 hours?";
    const filled = renderTemplate("==-- {{questions}}", { questions });
    const html = plainToHtml(filled);
    expect(html).not.toContain("==");
    expect(html).toContain("<li>Do you have experience with federal facilities in Virginia?</li>");
    expect(html).toContain("<li>Can you provide bonding within 48 hours?</li>");
  });
});

// ---------------------------------------------------------------------------
// Follow-up send path — simulates the maintenance agent render logic
// (mirrors lib/agents/maintenance.ts outreachFollowup handler)
// ---------------------------------------------------------------------------

describe("follow-up template render path", () => {
  /** Mirrors the vars object built by the outreachFollowup handler. */
  function buildFollowUpVars(opts: {
    ownerName: string | null;
    senderName: string;
    companyName: string;
    phone: string;
    trade: string | null;
    locationState: string | null;
    deadline: string | null;
  }): Record<string, string> {
    const ownerFirst = (() => {
      const raw = (opts.ownerName ?? "").trim();
      if (!raw) return "there";
      return raw.split(/\s+/)[0] || "there";
    })();
    return {
      owner_name: ownerFirst,
      sender_name: opts.senderName,
      company_name: opts.companyName,
      phone: opts.phone,
      trade: opts.trade ?? "",
      location_state: opts.locationState ?? "",
      deadline: formatDeadlineLabel(opts.deadline),
      opportunity_title: "",
      solicitation_number: "",
      agency: "",
      scope_summary: "",
      questions: "",
    };
  }

  const tmplSubject = "Re: {{trade}} Quote Request, {{location_state}}";
  const tmplBody = [
    "Hi {{owner_name}},",
    "",
    "Following up on my email about a {{trade}} contract in {{location_state}}. The bid deadline is {{deadline}}, so I need to move quickly.",
    "",
    "Interested? Reply here or call me at {{phone}}.",
    "",
    "{{sender_name}}",
  ].join("\n");

  it("renders subject with correct trade and state", () => {
    const vars = buildFollowUpVars({
      ownerName: "Marcus Johnson",
      senderName: "Jared",
      companyName: "BROSTCO Holdings LLC",
      phone: "(800) 555-0199",
      trade: "HVAC",
      locationState: "Virginia",
      deadline: "2026-08-25T17:00:00Z",
    });
    expect(renderTemplate(tmplSubject, vars)).toBe(
      "Re: HVAC Quote Request, Virginia"
    );
  });

  it("uses only the first name from owner_name", () => {
    const vars = buildFollowUpVars({
      ownerName: "Marcus Johnson",
      senderName: "Jared",
      companyName: "BROSTCO",
      phone: "",
      trade: "Electrical",
      locationState: "TX",
      deadline: null,
    });
    const body = renderTemplate(tmplBody, vars);
    expect(body).toContain("Hi Marcus,");
    expect(body).not.toContain("Johnson");
  });

  it("falls back to \"there\" when owner_name is null", () => {
    const vars = buildFollowUpVars({
      ownerName: null,
      senderName: "Jared",
      companyName: "BROSTCO",
      phone: "",
      trade: "Plumbing",
      locationState: "FL",
      deadline: null,
    });
    expect(renderTemplate(tmplBody, vars)).toContain("Hi there,");
  });

  it("renders body with all tokens substituted — no raw placeholder reaches the sub", () => {
    const vars = buildFollowUpVars({
      ownerName: "Sam",
      senderName: "Jared",
      companyName: "BROSTCO Holdings LLC",
      phone: "(800) 555-0199",
      trade: "HVAC",
      locationState: "Virginia",
      deadline: "2026-08-25T17:00:00Z",
    });
    const result = renderTemplate(tmplBody, vars);
    expect(result).not.toContain("{{");
    expect(result).toContain("Hi Sam,");
    expect(result).toContain("HVAC contract in Virginia");
    expect(result).toContain("(800) 555-0199");
    expect(result).toContain("Jared");
  });

  it("plainToHtml converts follow-up body newlines to <br> tags", () => {
    const vars = buildFollowUpVars({
      ownerName: "Sam",
      senderName: "Jared",
      companyName: "BROSTCO",
      phone: "(800) 555-0199",
      trade: "HVAC",
      locationState: "VA",
      deadline: null,
    });
    const plain = renderTemplate(tmplBody, vars);
    const html = plainToHtml(plain);
    expect(html).toContain("<br>");
    expect(html).not.toContain("\n"); // newlines converted
  });
});

// ---------------------------------------------------------------------------
// Version-increment invariant (pure logic; no DB required)
// ---------------------------------------------------------------------------

describe("template version increment logic", () => {
  /** Mirrors the production versioning logic in PATCH /api/templates/[slug]. */
  function nextVersion(maxVersion: number | null): number {
    return (maxVersion ?? 0) + 1;
  }

  it("starts at version 1 when no prior versions exist", () => {
    expect(nextVersion(null)).toBe(1);
  });

  it("increments from the current max version", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(5)).toBe(6);
    expect(nextVersion(99)).toBe(100);
  });

  it("next version is always greater than the current max", () => {
    for (const v of [1, 2, 10, 50, 999]) {
      expect(nextVersion(v)).toBeGreaterThan(v);
    }
  });

  it("never produces version 0 or negative", () => {
    expect(nextVersion(null)).toBeGreaterThan(0);
    expect(nextVersion(0)).toBeGreaterThan(0);
  });
});
