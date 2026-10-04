import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConversationThreads, type Conversation } from "../components/conversation-threads";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("../components/unsaved-guard", () => ({ UnsavedGuard: () => null }));
let root: Root, container: HTMLElement;
const fetchMock = vi.fn();
const conv: Conversation = { key: "thread", threadId: "thread", opportunityId: "project", opportunityTitle: "Project",
  trade: "Paint", subject: "Quote", lastAt: "2026-01-01", replyToMessageId: "<inbound>", awaitingUs: true,
  messages: [{ id: "incoming", direction: "inbound", subject: "Quote", body: "Please clarify", created_at: "2026-01-01",
    recipient_email: "historical@sub.test", sender_email: "historical@sub.test", kind: null, gmail_message_id: "in", rfc822_message_id: "<inbound>" }] };
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  const stored = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key,value), removeItem: (key: string) => stored.delete(key) });
  container = window.document.querySelector("main")! as unknown as HTMLElement; root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => root.render(<ConversationThreads subcontractorId="sub" canSend conversations={[conv]}
    savedDrafts={{ incoming: { communicationId: "incoming", body: "Our answer", warnings: [], edited: true, generatedAt: "2026-01-01", rev: 1 } }} />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent?.includes(label));
  expect(button).toBeDefined();
  await act(async () => button!.dispatchEvent(new window.Event("click", { bubbles: true })));
}
it("actual contact reply sends a UUID and preserves it after an uncertain response", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Uncertain" }), { status: 503 }));
  await mount(); await click("Send reply"); await click("Send reply");
  const payloads = fetchMock.mock.calls.filter(c => c[0] === "/api/conversations/reply").map(c => JSON.parse(c[1].body));
  expect(payloads).toHaveLength(2); expect(payloads[0].requestKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(payloads[1].requestKey).toBe(payloads[0].requestKey);
  expect(payloads[0]).toMatchObject({ subcontractorId: "sub", threadId: "thread", message: "Our answer" });
  expect(container.textContent).not.toContain("Prepare a new request");
  expect(container.textContent).toContain("From: historical@sub.test");
});
it("only offers a new request after explicit held/refused evidence", async () => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "Refused", safeToCompose: true }), { status: 502 }));
  await mount(); await click("Send reply");
  const first = JSON.parse(fetchMock.mock.calls[0][1].body).requestKey;
  await click("Prepare a new request"); await click("Send reply");
  expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).requestKey).not.toBe(first);
});
