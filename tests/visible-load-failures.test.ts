import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("important page load failures stay visible", () => {
  it.each([
    ["workbench", "app/(dash)/workbench/page.tsx", "The work queue could not be loaded"],
    ["communications", "app/(dash)/communications/page.tsx", "Unmatched inbound messages could not be checked"],
    ["integrations", "app/(dash)/settings/integrations/page.tsx", "The Gmail connection could not be checked"],
    ["billing", "app/(account)/settings/billing/page.tsx", "Invoice history could not be loaded"],
    ["notifications", "app/(account)/settings/notifications/page.tsx", "notification mailbox could not be checked"],
    ["account", "app/(account)/settings/account/page.tsx", "recap time zone and opt-out status could not be loaded"],
    ["recap settings", "app/(dash)/settings/recap/page.tsx", "recipient list could not be confirmed"],
    ["company profile", "app/(dash)/settings/profile/page.tsx", "version history could not be loaded"],
  ])("shows a warning on %s", (_name, path, message) => {
    const page = source(path);
    expect(page).toContain("ShellDataWarning");
    expect(page).toContain(message);
  });

  it("does not label an unknown recap recipient list as empty", () => {
    expect(source("app/(dash)/settings/recap/page.tsx")).toContain(
      '"On, recipient status unavailable"'
    );
  });

  it("does not label an unknown notification route as no delivery", () => {
    expect(source("app/(account)/settings/notifications/page.tsx")).toContain(
      '"Email delivery status unavailable"'
    );
  });
});
