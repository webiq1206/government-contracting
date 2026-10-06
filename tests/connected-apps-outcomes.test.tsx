import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { ConnectedApps } from "@/components/connected-apps";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
let root: Root; let container: HTMLElement;
const providers = [{ id: "slack", name: "Slack", kind: "notifications" }, { id: "google_drive", name: "Google Drive", kind: "files" }, { id: "google_calendar", name: "Google Calendar", kind: "calendar" }].map(p => ({ ...p, available: true, method: "oauth", scopes: ["company"], lets: "Saved connection", reads: "Read scope", writes: "Write scope", direction: "One way" }));
beforeEach(async () => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document); vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window.HTMLElement.prototype as HTMLDialogElement).showModal = function () { this.setAttribute("open", ""); };
  (window.HTMLElement.prototype as HTMLDialogElement).close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST" || init?.method === "DELETE") throw new Error("Provider connection timed out: private diagnostic");
    return new Response(JSON.stringify({ providers, connections: providers.map(p => ({ id: p.id, provider: p.id, personal: false, mine: false, status: "connected", settings: {}, last_error: null, last_synced_at: null })), webhooks: [{ id: "fixture-hook", label: "Fixture", url: "https://example.invalid/hook", events: [], active: true, last_status: null, last_delivered_at: null, failure_count: 0 }], canManageIntegrations: true, userId: "fixture" }));
  }));
  const { createRoot } = await import("react-dom/client"); container = document.querySelector("main")!; root = createRoot(container);
  await act(async () => root.render(<ConnectedApps notice={null} />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
describe("connector effects and uncertain outcomes", () => {
  it.each(["Disconnect", "Remove"])("allows closing an uncertain %s dialog while blocking a duplicate request", async label => {
    const trigger = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
    await act(async () => { trigger.dispatchEvent(new window.Event("click", { bubbles: true })); });
    const dialog = document.querySelector("dialog")!;
    const confirm = Array.from(dialog.querySelectorAll("button")).find(b => b.textContent === label)!;
    await act(async () => { confirm.dispatchEvent(new window.Event("click", { bubbles: true })); });
    expect(confirm.disabled).toBe(true);
    const cancel = Array.from(dialog.querySelectorAll("button")).find(b => b.textContent === "Cancel")!;
    expect(cancel.disabled).toBe(false);
    await act(async () => { cancel.dispatchEvent(new window.Event("click", { bubbles: true })); });
    expect(document.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Reload saved");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });
  it("discloses message and folder writes separately from a calendar read", () => {
    expect(container.textContent).toContain("Send a test message"); expect(container.textContent).toContain("Create a test folder");
    expect(container.textContent).toContain("Read available calendars"); expect(container.textContent).toContain("real test message");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });
  it("locks connector mutations after a lost response and offers saved-status reconciliation", async () => {
    const card = container.querySelector("#slack")!;
    const test = Array.from(card.querySelectorAll("button")).find(b => b.textContent === "Send a test message")!;
    await act(async () => { test.dispatchEvent(new window.Event("click", { bubbles: true })); });
    expect(card.textContent).toContain("may still be processing"); expect(card.textContent).not.toContain("private diagnostic");
    expect(test.disabled).toBe(true);
    expect(Array.from(card.querySelectorAll("button")).find(b => b.textContent === "Pause")?.disabled).toBe(true);
    expect(Array.from(card.querySelectorAll("button")).find(b => b.textContent === "Reload saved connection status before retrying")?.disabled).toBe(false);
  });
});
