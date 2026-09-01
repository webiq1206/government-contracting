import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The one card that says which address a customer's email goes out from.
 *
 * It is the only place in the product where that fact is visible, so it has
 * to be visible: an operator who cannot see the sending address cannot notice
 * that outreach is going out under the wrong one, which is exactly how the
 * company spent months emailing subcontractors from the mailbox that happened
 * to authorize the connection.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const { GoogleInboxCard } = await import("../components/google-inbox-card");

type Props = Parameters<typeof GoogleInboxCard>[0]["initial"];

const CONNECTED: Props = {
  connected: true,
  email: "hello@webiq.co",
  status: "connected",
  lastError: null,
  available: true,
  sendAs: null,
  sendAsProblem: null,
};

function render(initial: Partial<Props>, canManage = true) {
  return renderToStaticMarkup(
    <GoogleInboxCard initial={{ ...CONNECTED, ...initial }} canManage={canManage} />
  );
}

describe("the sending address the card reports", () => {
  it("shows the Google account when no other address has been chosen", () => {
    const html = render({});
    expect(html).toContain("hello@webiq.co");
  });

  it("shows the chosen address instead once one is set", () => {
    const html = render({ sendAs: "hello@brostco.com" });
    expect(html).toContain("hello@brostco.com");
    // And still says where replies land, since that is a different mailbox.
    expect(html).toContain("Signed in as hello@webiq.co");
  });

  it("offers a way to change it", () => {
    expect(render({})).toContain("Change");
  });

  it("does not offer that to someone who cannot manage integrations", () => {
    expect(render({}, false)).not.toContain(">Change<");
  });

  it("says so when the chosen address is no longer verified at Google", () => {
    const html = render({
      sendAs: "hello@brostco.com",
      sendAsProblem: "Google no longer lists hello@brostco.com as a verified address.",
    });
    expect(html).toContain("no longer lists hello@brostco.com");
  });

  it("asks for a connection rather than an address when nothing is connected", () => {
    const html = render({ connected: false, email: null, status: "none" });
    expect(html).toContain("Connect Google Inbox");
    expect(html).not.toContain("Sending as");
  });
});
