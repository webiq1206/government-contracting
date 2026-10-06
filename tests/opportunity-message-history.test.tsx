import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpportunityMessageHistory } from "@/components/opportunity-message-history";
import type { OppSubCommRow, OppSubRow } from "@/lib/data";
import { OpportunitySubsPanel } from "@/components/opportunity-subs-panel";

const row: OppSubCommRow = {
  id: "message-1", subcontractor_id: "sub-1", channel: "email", direction: "outbound",
  subject: "Quote request", body: "First line\nExact final line <script>untrusted</script>",
  created_at: "2026-10-05T16:12:34Z", replied_at: null, provider: null,
  sender_email: "sender@example.test", recipient_email: "saved-recipient@example.test",
  delivery_state: "draft", delivery_detail: null, opened_at: null, clicked_at: null,
  follow_up_at: null, gmail_message_id: null,
};

describe("opportunity communication evidence", () => {
  it("retains research scope and message evidence without bid-work recommendations", () => {
    const sub = { id: "pair-1", subcontractor_id: "sub-1", company_name: "Saved firm", trade: "Electrical", outreach_state: "responsive", emails_sent: 0, calls_logged: 0, touches: 1 } as OppSubRow;
    const html = renderToStaticMarkup(<OpportunitySubsPanel researchOnly subs={[sub]} communications={[row]} description="Saved full scope description" />);
    expect(html).toContain("Saved description: ");
    expect(html).toContain("Saved full scope description");
    expect(html).toContain("saved-recipient@example.test");
    expect(html).toContain("Draft, not sent");
    expect(html).not.toContain("Re-run the analysis");
    expect(html).not.toContain("Collect or confirm their quote");
    expect(html).not.toContain("Enter quote");
  });
  it.each([
    ["draft", "Draft, not sent"], ["held", "Held, not sent"],
    ["failed", "Never sent"], ["queued", "Queued, not attempted"],
    ["attempting", "Attempt recorded, outcome unconfirmed"], ["unknown", "Delivery uncertain"],
  ])("keeps %s separate from a sent message", (delivery_state, label) => {
    const html = renderToStaticMarkup(<OpportunityMessageHistory messages={[{ ...row, delivery_state }]} />);
    expect(html).toContain(label);
    expect(html).toContain("No delivery confirmation recorded.");
    expect(html).not.toContain("Delivery confirmation recorded.");
  });
  it("shows exact saved addresses, time and complete escaped text", () => {
    const html = renderToStaticMarkup(<OpportunityMessageHistory messages={[row]} />);
    expect(html).toContain("saved-recipient@example.test");
    expect(html).toContain("sender@example.test");
    expect(html).toContain("2026-10-05 16:12:34 UTC");
    expect(html).toContain("Exact final line &lt;script&gt;untrusted&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("line-clamp");
  });
  it("requires recorded delivery evidence instead of inferring it from a send", () => {
    const sent = { ...row, provider: "gmail", delivery_state: "sent" };
    expect(renderToStaticMarkup(<OpportunityMessageHistory messages={[sent]} />)).toContain("Sent, no confirmation yet");
    expect(renderToStaticMarkup(<OpportunityMessageHistory messages={[{ ...sent, delivery_state: "delivered" }]} />)).toContain("Delivery confirmation recorded.");
  });
  it("keeps empty and missing evidence explicit and uses native keyboard disclosures", () => {
    expect(renderToStaticMarkup(<OpportunityMessageHistory messages={[]} />)).toContain("No message or call details were loaded");
    const html = renderToStaticMarkup(<OpportunityMessageHistory messages={[{ ...row, sender_email: null, recipient_email: null, body: null }]} />);
    expect(html).toContain("Not recorded");
    expect(html).toContain("Message text was not saved.");
    expect(html).toContain("<summary");
  });
  it("does not hide older loaded messages after eight entries", () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({ ...row, id: `message-${i}`, body: `Body number ${i}` }));
    expect(renderToStaticMarkup(<OpportunityMessageHistory messages={messages} />)).toContain("Body number 11");
  });
});
