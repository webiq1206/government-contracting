import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuideWizard } from "@/components/guide-wizard";
const nav = vi.hoisted(() => ({ path: "/opportunity/11111111-1111-4111-8111-111111111111", router: { refresh: vi.fn(), replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => nav.router, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/guide-adapters", () => ({ GuideStepActions: () => null }));
vi.mock("@/lib/client-analytics", () => ({ trackClientEvent: vi.fn() }));
const fetchMock = vi.fn();
let root: Root;
const result = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const guide = () => ({ pathname: nav.path, pageKey: "opportunity", experience: "familiar", headline: "Saved record",
  situation: "Review the saved facts", completed: [], needsAttention: [], brostHandling: [], whatHappensNext: null,
  steps: [], idle: false, pageExplain: null, terms: [], scoreExplain: null, badgeCount: 0, automationPaused: false });
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("Event", window.Event); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  root = createRoot(document.querySelector("main")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function button(text: string) { return [...document.querySelectorAll("button")].find(node => node.textContent === text)!; }
async function mount(answer: () => Promise<Response>) {
  fetchMock.mockImplementation((url: string) => url === "/api/guide/ask" ? answer()
    : Promise.resolve(result(url.startsWith("/api/guide?") ? { guide: guide(), adapters: {} } : {})));
  await act(async () => root.render(<GuideWizard />));
  await act(async () => window.dispatchEvent(new window.Event("open-guide-wizard")));
  await act(async () => button("Ask").dispatchEvent(new window.Event("click", { bubbles: true })));
}
async function ask() {
  await act(async () => button("What should I do next?").dispatchEvent(new window.Event("click", { bubbles: true })));
  await act(async () => document.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
it("shows descriptive citations tied to the current authorized record and rejects arbitrary destinations", async () => {
  await mount(async () => result({ answer: "Review the saved requirement.", sources: [
    { label: "Saved requirement <script>unsafe</script>", href: `${nav.path}#brief` },
    { label: "Account workload", href: "/today" },
    { label: "External", href: "https://example.test" },
    { label: "Foreign record", href: "/opportunity/22222222-2222-4222-8222-222222222222#brief" },
    { label: "Admin", href: "/admin/accounts" },
  ] }));
  await ask();
  const source = document.querySelector(`a[href="${nav.path}#brief"]`)!;
  expect(source).not.toBeNull();
  expect(source.textContent).toBe("Saved requirement <script>unsafe</script>");
  expect(source.className).toContain("break-words");
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector('a[href="/admin/accounts"]')).toBeNull();
  expect(document.body.textContent).toContain("Recorded facts");
  expect(document.body.textContent).not.toContain("Foreign record");
});
it("does not show an empty successful answer", async () => {
  await mount(async () => result({ answer: "  ", sources: [] })); await ask();
  expect(document.body.textContent).toContain("No answer was returned");
});
it("discards a late answer after the panel closes and reopens", async () => {
  let finish!: (response: Response) => void;
  await mount(() => new Promise(resolve => { finish = resolve; })); await ask();
  await act(async () => button("Close").dispatchEvent(new window.Event("click", { bubbles: true })));
  await act(async () => window.dispatchEvent(new window.Event("open-guide-wizard")));
  await act(async () => finish(result({ answer: "Stale answer", sources: [{ label: "Old source", href: "/today" }] })));
  await act(async () => button("Ask").dispatchEvent(new window.Event("click", { bubbles: true })));
  expect(document.body.textContent).not.toContain("Stale answer");
  expect(document.body.textContent).not.toContain("Old source");
});
