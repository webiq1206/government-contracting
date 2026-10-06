import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EmailTemplateEditor } from "@/components/email-template-editor";
import { templateMetrics } from "@/lib/domain/template-health";

vi.mock("@/components/unsaved-guard", () => ({ UnsavedGuard: () => null }));
vi.mock("@/components/confirm-dialog", () => ({ ConfirmDialog: () => null }));
const fetchMock = vi.fn();
let root: Root, container: HTMLElement;
const template = { id: "template", slug: "template_1_outreach", version: 1,
  subject: "Project: {{opportunity_title}}", body: "Please review this project.", description: null };
const pairs = ["first", "second"].map(id => ({ opportunity_id: id,
  subcontractor_id: "sub", trade: "Electrical", company_name: "Saved firm",
  opportunity_title: `${id} project` }));
const context = (title: string) => ({ vars: { opportunity_title: title }, scopeBoundary: "",
  missingRequired: [], warnings: [], attachedNames: [] });
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  container = window.document.querySelector("main")! as unknown as HTMLElement;
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function button(text: string) {
  return [...container.querySelectorAll("button")].find(node => node.textContent === text)!;
}
async function mount(selectedTemplate = template) {
  await act(async () => root.render(<EmailTemplateEditor template={selectedTemplate} followupHours={48}
    metrics={templateMetrics({ sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, lastSentAt: null })} />));
  await act(async () => button("Preview email").dispatchEvent(new window.Event("click", { bubbles: true })));
}
async function select(value: string) {
  const el = container.querySelector("select")!;
  const key = Object.keys(el).find(key => key.startsWith("__reactProps$"))!;
  const props = (el as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[key];
  await act(async () => props.onChange({ target: { value } }));
}
it("does not restore a late real-record response after choosing sample values", async () => {
  const pending = deferred<Response>();
  fetchMock.mockImplementation((url: string) => url.includes("list=1")
    ? Promise.resolve(response({ pairings: pairs })) : pending.promise);
  await mount();
  expect(container.textContent).toContain("an association does not verify trade fit");
  expect(container.textContent).not.toContain("firm whose trades match");
  await select("first|sub|Electrical");
  expect(button("Send test email").disabled).toBe(true);
  await select("");
  await act(async () => pending.resolve(response(context("Late real project"))));
  expect(container.textContent).toContain("Email preview · sample values");
  expect(container.textContent).not.toContain("Late real project");
  expect(button("Send test email").disabled).toBe(false);
});
it("keeps the newest real-record selection when older reads finish last", async () => {
  const first = deferred<Response>(), second = deferred<Response>();
  fetchMock.mockImplementation((url: string) => url.includes("list=1")
    ? Promise.resolve(response({ pairings: pairs }))
    : url.includes("opportunityId=first") ? first.promise : second.promise);
  await mount();
  await select("first|sub|Electrical");
  await select("second|sub|Electrical");
  await act(async () => second.resolve(response(context("Newest real project"))));
  await act(async () => first.resolve(response(context("Stale real project"))));
  expect(container.textContent).toContain("Subject: Project: Newest real project");
  expect(container.textContent).not.toContain("Stale real project");
  expect(button("Send test email").disabled).toBe(false);
});
it("ignores a stale rejected read after closing, reopening, and choosing samples", async () => {
  const pending = deferred<Response>();
  fetchMock.mockImplementation((url: string) => url.includes("list=1")
    ? Promise.resolve(response({ pairings: pairs })) : pending.promise);
  await mount();
  await select("first|sub|Electrical");
  await act(async () => button("Close").dispatchEvent(new window.Event("click", { bubbles: true })));
  await act(async () => button("Preview email").dispatchEvent(new window.Event("click", { bubbles: true })));
  await select("");
  await act(async () => pending.reject(new Error("Stale record failed")));
  expect(container.textContent).toContain("Email preview · sample values");
  expect(container.textContent).not.toContain("Stale record failed");
  expect(container.textContent).not.toContain("Loading that record");
  expect(button("Send test email").disabled).toBe(false);
});
it("requires an accepted receipt before claiming a successful test", async () => {
  fetchMock.mockImplementation(async (url: string) => response(url.includes("list=1") ? { pairings: [] } : {}));
  await mount();
  await act(async () => button("Close").dispatchEvent(new window.Event("click", { bubbles: true })));
  await act(async () => button("Send test email").dispatchEvent(new window.Event("click", { bubbles: true })));
  expect(container.textContent).not.toContain("Gmail accepted the test");
  expect(container.textContent).toContain("Check Gmail Sent and the test inbox before sending another test");
});
it("does not start two sends from repeated clicks before React updates the button", async () => {
  const pending = deferred<Response>();
  fetchMock.mockImplementation((url: string) => url.includes("list=1")
    ? Promise.resolve(response({ pairings: [] })) : pending.promise);
  await mount();
  await act(async () => button("Close").dispatchEvent(new window.Event("click", { bubbles: true })));
  const send = button("Send test email");
  await act(async () => {
    send.dispatchEvent(new window.Event("click", { bubbles: true }));
    send.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  await act(async () => pending.resolve(response({ ok: true, messageId: "test-receipt", sentTo: "operator@example.test" })));
  expect(container.textContent).toContain("Gmail accepted the test to operator@example.test");
});

it("labels unchanged custom wording honestly and does not invent attached files in sample preview", async () => {
  fetchMock.mockResolvedValue(response({pairings: []}));
  const body="Please review attached bid documents. Keep this approved custom wording.";
  await mount({...template, body});
  expect(container.querySelector('.email-preview')?.textContent).toContain(body);
  expect(container.querySelector('.email-preview')?.textContent).not.toContain('The 2 attached documents');
  expect(container.querySelector('[role="note"]')?.textContent).toContain('No files are attached or verified');
  expect(container.querySelector('[role="note"]')?.textContent).toContain('Template wording below is unchanged');
  expect(container.textContent).not.toContain('this preview always looks right');
  expect(fetchMock.mock.calls.some(([,options]) => options?.method === 'POST')).toBe(false);
});
