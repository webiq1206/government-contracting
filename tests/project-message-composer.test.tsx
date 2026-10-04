import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProjectMessageComposer } from "../components/project-message-composer";
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("../components/unsaved-guard", () => ({ UnsavedGuard: () => null }));
let root: Root, container: HTMLElement;
const fetchMock = vi.fn();
const key = "project-message:sub:project:Paint";
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  const stored = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k,v), removeItem: (k: string) => stored.delete(k) });
  container = window.document.querySelector("main")! as unknown as HTMLElement; root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => root.render(<ProjectMessageComposer subId="sub" projectId="project" trade="Paint" recipient="sub@example.test" sender="owner@example.test" ready />));
}
async function remount() { await act(async () => root.unmount()); root = createRoot(container); await mount(); }
function button(label: string) { return [...container.querySelectorAll("button")].find(b => b.textContent?.includes(label)); }
async function click(label: string) {
  const b = button(label); expect(b).toBeDefined(); expect(b!.disabled).toBe(false);
  await act(async () => b!.dispatchEvent(new window.Event("click", { bubbles: true })));
}
async function edit(id: string, value: string) {
  const field = container.querySelector(`#${id}`)! as HTMLInputElement;
  expect(field.disabled).toBe(false);
  const propsKey = Object.keys(field).find(k => k.startsWith("__reactProps$"))!;
  await act(async () => (field as any)[propsKey].onChange({ target: { value } }));
}
it.each(["held", "refused"])("retains confirmed %s reset eligibility through edits and remount without sending", async outcome => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: outcome, safeToCompose: true }), { status: 409 }));
  await mount(); await edit("project-message-subject", "First subject"); await edit("project-message-body", "First text"); await click("Send message");
  const first = JSON.parse(fetchMock.mock.calls[0][1].body).requestKey;
  await edit("project-message-body", "Revised text");
  expect(button("Send message")!.disabled).toBe(true);
  expect(sessionStorage.getItem(`${key}:confirmed-nondelivery`)).toBe(first);
  await remount();
  expect(button("Prepare a new request")).toBeDefined();
  await edit("project-message-subject", "Revised subject"); await edit("project-message-body", "Revised text");
  await click("Prepare a new request");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(key)).toBeNull();
  await click("Send message");
  const second = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(second.requestKey).not.toBe(first); expect(second.message).toBe("Revised text");
});
it.each(["unknown", "accepted"])("locks %s intent across remount and never offers replacement", async outcome => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(outcome === "accepted" ? { ok: true } : { error: "unknown" }), { status: outcome === "accepted" ? 200 : 503 }));
  await mount(); await edit("project-message-subject", "Subject"); await edit("project-message-body", "Text"); await click("Send message");
  const first = sessionStorage.getItem(key); expect(first).toBeTruthy();
  await remount();
  expect(button("Prepare a new request")).toBeUndefined();
  expect(button("Send message")!.disabled).toBe(true);
  expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  expect(sessionStorage.getItem(key)).toBe(first); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not apply stale nondelivery evidence to another request key", async () => {
  sessionStorage.setItem(key, "current-unknown"); sessionStorage.setItem(`${key}:confirmed-nondelivery`, "old-refused");
  await mount(); expect(button("Prepare a new request")).toBeUndefined(); expect(button("Send message")!.disabled).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});
