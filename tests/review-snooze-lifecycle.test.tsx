import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { ReviewBriefPanel } from "@/components/review-brief";
import { buildReviewBrief } from "@/lib/domain/review-brief";
import { ACTION_UNCONFIRMED } from "@/lib/client/action-request";

const state = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push, refresh: state.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/toaster", () => ({ useToast: () => ({ push: state.toast }) }));
vi.mock("@/components/workspace/workspace-keys", () => ({ useWorkspaceShortcut: vi.fn() }));
let root: Root;
let container: HTMLElement;
let resolveRequest: (response: Response) => void;
let requestSignal: AbortSignal | null;
const brief = buildReviewBrief({ score: 68, dimensions: [], riskFlags: [], confidence: null, deadline: null, reviewExpiresAt: null, requiredTradeCount: null, valueKnown: false, pastPerfClassification: null, value: null, valueSource: null, conflicts: [], sourceLinks: [] });
beforeEach(async () => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn((_url, init) => {
    requestSignal = init.signal;
    return new Promise<Response>(resolve => { resolveRequest = resolve; });
  }));
  state.push.mockClear(); state.refresh.mockClear(); state.toast.mockClear();
  const { createRoot } = await import("react-dom/client");
  container = document.querySelector("main")!; root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(id = "a") {
  await act(async () => root.render(<ReviewBriefPanel opportunityId={id} title={`Opportunity ${id}`} subtitle="Saved evidence" brief={brief} canDecide closeHref="/review" nextHref="/review?o=b" />));
}
function button(label: string) { return Array.from(container.querySelectorAll("button")).find(node => node.textContent === label)!; }
async function click(label: string) { await act(async () => { button(label).dispatchEvent(new window.Event("click", { bubbles: true })); }); }
async function startSnooze() { await click("Snooze"); await click("Until tomorrow"); }
describe("review snooze lifecycle", () => {
  it("locks competing decisions until snooze is confirmed, then advances once", async () => {
    await render(); await startSnooze();
    expect(button("Pursue & next").disabled).toBe(true); expect(button("Pass").disabled).toBe(true);
    expect(state.push).not.toHaveBeenCalled();
    await act(async () => resolveRequest(new Response(JSON.stringify({ ok: true }))));
    expect(state.push).toHaveBeenCalledOnce(); expect(state.push).toHaveBeenCalledWith("/review?o=b", { scroll: false });
  });
  it("aborts A on navigation and leaves B enabled without applying A's late response", async () => {
    await render(); await startSnooze(); const oldSignal = requestSignal;
    await render("b"); expect(oldSignal?.aborted).toBe(true);
    expect(button("Pursue & next").disabled).toBe(false); expect(button("Snooze").disabled).toBe(false);
    await act(async () => resolveRequest(new Response(JSON.stringify({ ok: true }))));
    expect(state.push).not.toHaveBeenCalled(); expect(state.toast).not.toHaveBeenCalled();
  });
  it("keeps unknown outcomes locked and offers a status check without claiming success", async () => {
    await render(); await startSnooze();
    await act(async () => resolveRequest(new Response("unavailable", { status: 503 })));
    expect(container.textContent).toContain(ACTION_UNCONFIRMED);
    expect(button("Pursue & next").disabled).toBe(true); expect(button("Pass").disabled).toBe(true);
    expect(container.querySelector('a[href="/opportunity/a"]')).not.toBeNull();
    expect(state.push).not.toHaveBeenCalled(); expect(state.toast).not.toHaveBeenCalled();
  });
});
