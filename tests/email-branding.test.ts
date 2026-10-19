/**
 * Every email leaves in a deliberate layout.
 *
 * Platform email (from BrostCo) always renders in the branded shell, whatever
 * the caller passed. Subcontractor email (from the customer's own inbox) is
 * always a plain, consistent business letter with the company's signature,
 * never the BrostCo banner. Text that came from outside is always escaped.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buttonLabel,
  composeSystemEmailHtml,
  isCompleteEmailDocument,
  plainTextToSystemBlocks,
  titleFromSubject,
} from "@/lib/domain/system-email";
import {
  complianceDigestEmail,
  kpiDigestEmail,
  learningLoopEmail,
  operatorAlertEmail,
  passwordResetEmail,
  replyNotificationEmail,
  trialWarningEmail,
} from "@/lib/domain/report-emails";
import { letterHtml, signatureLines, wrapLetter } from "@/lib/domain/outreach-letter";
import { plainToHtml } from "@/lib/domain/template-render";
import { buildDeclineThankYouEmail } from "@/lib/domain/decline-closeout";

const APP = "https://brostco.com";
const branded = (html: string) => {
  expect(isCompleteEmailDocument(html)).toBe(true);
  expect(html).toContain(`${APP}/brand/wordmark-light.png`);
  expect(html).toContain('alt="BrostCo"');
  expect(html).toContain("brostco.com</a>");
  // The retired palette must not come back.
  expect(html).not.toMatch(/#2457E6|#B28F5D|#b2c7ff|#ccd8eb/i);
};

describe("platform email is always branded", () => {
  it("lays out plain text: paragraphs, lists, and the first link as a button", () => {
    const html = composeSystemEmailHtml(APP, {
      subject: "Your BrostCo trial ends tomorrow",
      text: "Your trial ends tomorrow.\n\nThings that stay:\n- Your profile\n- Your subcontractors\n\nChoose a plan: https://brostco.com/settings/billing\n\nBrost Co",
    });
    branded(html);
    expect(html).toContain("<ul");
    expect(html).toContain("Your subcontractors");
    expect(html).toMatch(/<a href="https:\/\/brostco\.com\/settings\/billing"[^>]*>Choose a plan<\/a>/);
    // A bare brand sign-off is dropped: the footer already says who sent it.
    expect(html).not.toMatch(/>Brost Co</);
  });

  it("wraps an HTML fragment and passes a finished document through", () => {
    const wrapped = composeSystemEmailHtml(APP, { subject: "x", text: "x", html: "<p>Fragment</p>" });
    branded(wrapped);
    expect(wrapped).toContain("<p>Fragment</p>");
    const finished = passwordResetEmail(APP, { name: "Pat", resetUrl: `${APP}/reset?t=1` }).html;
    expect(composeSystemEmailHtml(APP, { subject: "x", text: "x", html: finished })).toBe(finished);
  });

  it("titles from the subject without repeating the brand", () => {
    expect(titleFromSubject("BROST CO: 3 subcontractor replies received")).toBe("3 subcontractor replies received");
    expect(titleFromSubject("BrostCo released a stuck hold")).toBe("Released a stuck hold");
    expect(buttonLabel("Update your payment method:")).toBe("Update your payment method");
    expect(buttonLabel("")).toBe("Open BrostCo");
  });

  it("keeps a lead-in sentence above its list", () => {
    const { blocks } = plainTextToSystemBlocks("Items that need attention:\n- One\n- Two");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("Items that need attention:");
    expect(blocks[1]).toContain("<li");
  });

  it("builds every report and notice in the shell, with a matching plain-text part", () => {
    const emails = [
      kpiDigestEmail(APP, {
        win_rate: { overall: 0, won: 0, lost: 0 }, avg_margin_on_wins_pct: 0, pipeline_value: 15775075000,
        pipeline_count: 2027, pipeline_valued: 412, active_contract_revenue: 0,
        cash_flow_projection: { basis: "milestones", buckets: [{ days: 30, amount: 0 }] },
        pipeline_velocity: { by_stage: [{ stage: "monitoring", count: 1890 }] },
      }),
      learningLoopEmail(APP, { wins: 0, losses: 0, proposedVersion: null, subUpdated: 2027, subPromoted: 0, insights: [] }),
      replyNotificationEmail(APP, [{ title: "Acme, about Job", detail: "Quote saved." }]),
      operatorAlertEmail(APP, { subject: "Pursue work is waiting", text: "3 items are waiting." }),
      passwordResetEmail(APP, { resetUrl: `${APP}/reset?t=1` }),
      trialWarningEmail(APP, { daysLeft: 3 }),
      complianceDigestEmail(APP, [{ name: "Acme", items: ["COI expired"], expired: true, working: true }]),
    ];
    for (const email of emails) {
      branded(email.html);
      expect(email.subject.trim()).not.toBe("");
      expect(email.text.trim()).not.toBe("");
      expect(email.subject).not.toMatch(/BROST CO|Brost Co/);
    }
  });

  it("shows large figures with separators and says when the pipeline figure is partial", () => {
    const { html, subject } = kpiDigestEmail(APP, {
      win_rate: { overall: 0, won: 0, lost: 0 }, avg_margin_on_wins_pct: 0, pipeline_value: 15775075000,
      pipeline_count: 2027, pipeline_valued: 412, active_contract_revenue: 0,
      cash_flow_projection: { basis: "milestones", buckets: [] },
      pipeline_velocity: { by_stage: [{ stage: "monitoring", count: 1890 }] },
    });
    expect(subject).toBe("BrostCo weekly KPIs: no bid decisions yet, $15,775,075,000 pipeline");
    expect(html).toContain("412 of 2,027 open opportunities publish an estimate");
    expect(html).toContain("1,890");
    expect(html).toContain("No decisions yet");
  });

  it("escapes everything a subcontractor or a public notice wrote", () => {
    const { html } = replyNotificationEmail(APP, [{
      title: '<img src=x onerror=alert(1)>, about <b>Job</b>',
      detail: "Quote saved.",
      snippet: "<script>alert(1)</script>",
    }]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("routes every platform sender through the branded renderer", () => {
    expect(readFileSync("lib/integrations/system-mail.ts", "utf8")).toContain("composeSystemEmailHtml(config.appUrl, params)");
    for (const file of ["lib/agents/analytics-engine.ts", "lib/agents/learning-loop.ts", "lib/agents/maintenance.ts", "lib/outage-alert.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/#2457E6|#B28F5D|font-family:Inter/i);
    }
  });
});

describe("subcontractor email is a consistent business letter", () => {
  it("wraps once, in one font, without the platform banner", () => {
    const once = wrapLetter("<p>Hi</p>");
    expect(wrapLetter(once)).toBe(once);
    expect(once).toContain("font-family:Arial,Helvetica,sans-serif");
    expect(once).not.toContain("wordmark");
    expect(letterHtml("Hi\n\nThanks")).toContain("<p");
  });

  it("renders blank lines as paragraphs and keeps a signature together", () => {
    const html = plainToHtml("Hi Dana,\n\nBody line.\n\nThanks,\nJared\nBROSTCO Holdings LLC");
    expect(html.match(/<p /g)).toHaveLength(3);
    expect(html).toContain("Thanks,<br>Jared<br>BROSTCO Holdings LLC");
  });

  it("signs as the company, with a phone when one is on file, and never as the platform", () => {
    expect(signatureLines({ outreach_display_name: "Jared Brost", legal_name: "BROSTCO Holdings LLC", phone: "(406) 555-0142" }))
      .toEqual(["Jared Brost", "BROSTCO Holdings LLC", "(406) 555-0142"]);
    expect(signatureLines({ owner_name: "Pat Lee", legal_name: "Lee Builders" })).toEqual(["Pat Lee", "Lee Builders"]);
    expect(signatureLines(null)).toEqual([]);
    const decline = buildDeclineThankYouEmail({ firstName: "Dana", opportunityTitle: "Hangar 4", senderName: "Jared", senderCompany: "BROSTCO Holdings LLC", senderPhone: "555" });
    expect(decline.text).toMatch(/Best regards,\nJared\nBROSTCO Holdings LLC\n555$/);
    for (const file of ["lib/agents/sub-onboarding.ts", "lib/domain/reply-clarify.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("signatureLines(");
      expect(src).not.toMatch(/^\s*"Brost Co",?$/m);
    }
  });

  it("applies the letter layout at the transport, for every agent", () => {
    expect(readFileSync("lib/integrations/email-transport.ts", "utf8")).toContain("html: wrapLetter(params.html)");
    expect(readFileSync("lib/backlink-send.ts", "utf8")).toContain("html: wrapLetter(message.html)");
  });
});
