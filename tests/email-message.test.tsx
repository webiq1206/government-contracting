import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { emailText, splitEmailBody } from "../lib/domain/email-body";
import { EmailMessage, EmailTimeline } from "../components/email-message";

afterEach(() => vi.unstubAllEnvs());

describe("email reading without losing original content", () => {
  it("separates a Gmail reply from quoted history", () => {
    expect(splitEmailBody("We can quote Friday.\n\nOn Tue, Sep 15, Alex <alex@example.com> wrote:\n> Please quote."))
      .toEqual({ current: "We can quote Friday.", quoted: "On Tue, Sep 15, Alex <alex@example.com> wrote:\n> Please quote." });
  });
  it("recognizes Outlook history only with supporting headers", () => {
    expect(splitEmailBody("Approved\nFrom: Alex\nSent: Tuesday\nTo: Sam\nSubject: Quote").current).toBe("Approved");
    expect(splitEmailBody("Scope\nFrom: basement to attic\nInclude painting").quoted).toBe("");
  });
  it("keeps inline answers and quote-only messages visible", () => {
    for (const body of ["> Question\nAnswer", "Answer\n> Question\nAnother answer", "> Quote only"]) {
      expect(splitEmailBody(body).current).toBe(body);
      expect(splitEmailBody(body).quoted).toBe("");
    }
  });
  it("preserves plain-text email addresses and escapes HTML for display", () => {
    expect(emailText("Alex <alex@example.com>")).toBe("Alex <alex@example.com>");
    expect(emailText("Alex <a@example.com>")).toBe("Alex <a@example.com>");
    expect(emailText('<a href="https://example.test/quote">View quote</a>')).toBe("View quote (https://example.test/quote)");
    expect(emailText('<p>Hello &amp; thanks</p><script>alert(1)</script><p>Friday</p>')).toBe("Hello & thanks\nFriday");
  });
  it("keeps the complete history accessible but collapsed and labels the latest email", () => {
    const html = renderToStaticMarkup(<EmailTimeline messages={[
      <EmailMessage key="old" direction="outbound" contact="Acme" body="Original request" date="2026-09-15T10:00:00Z" />,
      <EmailMessage key="new" direction="inbound" contact="Acme" body={"Friday works\nOn Tuesday Alex wrote:\n> Original request"} date="2026-09-15T11:00:00Z" latest />,
    ]} />);
    const { document } = parseHTML(html);
    expect(document.querySelectorAll("article")).toHaveLength(2);
    expect(document.querySelectorAll("details[open]")).toHaveLength(0);
    expect(document.querySelectorAll("details")).toHaveLength(2);
    expect(html).toContain("Latest message");
    expect(html).toContain("Show quoted history");
    expect(html).toContain("Friday works");
    expect(html).toContain("Original request");
    expect(html).toContain("Acme");
  });
  it("renders a draft as unsent and unsafe markup as text", () => {
    const html = renderToStaticMarkup(<EmailMessage direction="outbound" contact="Acme" body={'<svg onload="alert(1)">'} date="2026-09-15T10:00:00Z" label="Unsent draft" latest />);
    const { document } = parseHTML(html);
    expect([...document.querySelectorAll('header span')].map(node => node.textContent)).toEqual(['Unsent draft', 'Latest message']);
    expect(html).toContain("Unsent draft");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Sent email");
  });
  it("shows a recorded UTC timestamp consistently on server and client", () => {
    const renderTime = (zone: string) => {
      vi.stubEnv("TZ", zone);
      const html = renderToStaticMarkup(<EmailMessage direction="outbound" contact="Acme" body="Saved draft" date="2026-10-06T03:03:00Z" label="Unsent draft" />);
      const { document } = parseHTML(html);
      const time = document.querySelector("time");
      return { text: time?.textContent, dateTime: time?.getAttribute("dateTime") ?? time?.getAttribute("datetime") };
    };
    expect(renderTime("UTC")).toEqual({ text: "Recorded: Oct 6, 2026, 3:03 AM UTC", dateTime: "2026-10-06T03:03:00.000Z" });
    expect(renderTime("America/Denver")).toEqual(renderTime("UTC"));
  });
  it("does not claim an instant when a stored timestamp has no timezone", () => {
    const html = renderToStaticMarkup(<EmailMessage direction="outbound" contact="Acme" body="Historical message" date="2026-10-06 03:03:00" />);
    const { document } = parseHTML(html);
    expect(document.querySelector("time")?.textContent).toBe("Recorded: Time unavailable");
    expect(document.querySelector("time")?.hasAttribute("datetime")).toBe(false);
    expect(document.querySelector("time")?.hasAttribute("dateTime")).toBe(false);
    expect(html).not.toContain("Invalid Date");
  });
  it("keeps historical subjects, bodies and missing address evidence unchanged", () => {
    const html = renderToStaticMarkup(<EmailMessage direction="outbound" contact="Acme" subject="Low-voltage and fiber" body="Following up about Electrical." date="2026-10-06T03:03:00Z" />);
    expect(html).toContain("Subject: Low-voltage and fiber");
    expect(html).toContain("Following up about Electrical.");
    expect(html).toContain("From: Not recorded for this historical message");
    expect(html).toContain("To: Not recorded for this historical message");
  });
  it("preserves saved outbound addresses and the legacy inbound From field", () => {
    const outbound = renderToStaticMarkup(<EmailMessage direction="outbound" contact="Acme" sender="original@sender.test" recipient="saved@recipient.test" body="Hello" date="2026-10-06T03:03:00Z" />);
    expect(outbound).toContain("From: original@sender.test");
    expect(outbound).toContain("To: saved@recipient.test");
    const inbound = renderToStaticMarkup(<EmailMessage direction="inbound" contact="Acme" recipient="legacy-sender@example.test" body="Reply" date="2026-10-06T03:03:00Z" />);
    expect(inbound).toContain("From: legacy-sender@example.test");
    expect(inbound).not.toContain("To: legacy-sender@example.test");
  });
});
