import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageBillingControls } from "../components/usage-billing-controls";
describe("reconciliation capability disclosure", () => {
  it("explains retained uncertainty without offering an unverified receipt upload", () => {
    const html = renderToStaticMarkup(<UsageBillingControls />);
    expect(html).toContain("Manual cost reconciliation and receipt uploads are unavailable");
    expect(html).toContain("Unverified costs remain held");
    expect(html).toContain("Twilio adapter");
    expect(html).toContain("Importing new external usage does not settle an existing reservation");
    expect(html).not.toContain("Receipt JSON");
    expect(html).not.toContain("Validate and reconcile receipts");
  });
});
