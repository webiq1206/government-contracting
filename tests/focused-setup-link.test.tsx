import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { FocusedToday } from "@/components/focused-today";
import { SetupChecklist } from "@/components/setup-checklist";
import { computeSetupChecklist } from "@/lib/domain/setup";

vi.mock("@/components/pending-link", () => ({ PendingLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
it("takes an empty signed-in workspace to the real setup checklist rather than the redirecting setup page", () => {
  const checklist = computeSetupChecklist({ profile: null, integrations: { sam: false, claude: false, googleMaps: false, gmail: false } });
  const html = renderToStaticMarkup(<><FocusedToday items={[]} overdue={0} dueToday={0} completed={0}
    activity={[]} setupRemaining={checklist.requiredRemaining} /><SetupChecklist checklist={checklist} /></>);
  const { document } = parseHTML(html);
  const action = [...document.querySelectorAll("a")].find(a => a.textContent === "Continue setup")!;
  expect(action.getAttribute("href")).toBe("/today#setup-checklist");
  const target = document.querySelector("#setup-checklist");
  expect(target).not.toBeNull();
  expect(target?.querySelectorAll('a[href^="/settings/"]').length).toBeGreaterThan(0);
});
