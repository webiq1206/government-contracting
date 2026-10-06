import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactDiscoveryEvidence } from "@/components/contact-discovery-evidence";
describe("saved public contact provenance", () => {
  it("shows source and exact time without claiming verification or sending", () => {
    const html = renderToStaticMarkup(<ContactDiscoveryEvidence verification={{ email_discovery: { email: "bids@firm.test", source_url: "https://firm.test/contact", source_type: "website", checked_at: "2026-10-05T10:00:00Z" } }} />);
    expect(html).toContain("bids@firm.test"); expect(html).toContain('href="https://firm.test/contact"');
    expect(html).toContain("2026-10-05 10:00:00 UTC"); expect(html).toContain("does not confirm");
  });
  it("preserves missing historical evidence and rejects non-web source links", () => {
    expect(renderToStaticMarkup(<ContactDiscoveryEvidence />)).toContain("No public email discovery source was saved");
    const html = renderToStaticMarkup(<ContactDiscoveryEvidence verification={{ email_discovery: { source_url: "javascript:alert(1)", checked_at: "bad-date" } }} />);
    expect(html).not.toContain("href="); expect(html).toContain("Time not recorded");
  });
});
