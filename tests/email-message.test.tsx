import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { emailText, splitEmailBody } from "../lib/domain/email-body";
import { EmailMessage, EmailTimeline } from "../components/email-message";

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
    const html = renderToStaticMarkup(<EmailMessage direction="outbound" contact="Acme" body={'<svg onload="alert(1)">'} date="2026-09-15T10:00:00Z" label="Unsent draft" />);
    expect(html).toContain("Unsent draft");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Sent email");
  });
});
