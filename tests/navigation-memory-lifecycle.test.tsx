import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { ContextBackLink, NavigationMemory } from "@/components/navigation-memory";

const route = vi.hoisted(() => ({ path: "/pipeline", query: "stage=outreach" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path, useSearchParams: () => new URLSearchParams(route.query) }));
vi.mock("next/link", () => ({ default: ({ children, href, scroll: _scroll, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
let root: Root;
const saved = new Map<string, string>();
const opportunity = "/opportunity/00000000-0000-0000-0000-000000000001";
const sub = "/subs/00000000-0000-0000-0000-000000000002";
beforeEach(async () => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("getComputedStyle", () => ({ overflowY: "visible" }));
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) });
  saved.clear();
  const { createRoot } = await import("react-dom/client"); root = createRoot(document.querySelector("main")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(path: string, href: string, back = false, scope = "company-a") {
  route.path = path; route.query = path === "/pipeline" ? "stage=outreach" : "";
  vi.stubGlobal("location", new URL(`https://workspace.invalid${path}${route.query ? `?${route.query}` : ""}`));
  await act(async () => root.render(<NavigationMemory scope={scope}>{back ? <ContextBackLink href="/subs">Back</ContextBackLink> : <a href={href}>Open record</a>}</NavigationMemory>));
}
async function click() {
  const event = new window.Event("click", { bubbles: true }); Object.defineProperty(event, "button", { value: 0 });
  await act(async () => { document.querySelector("a")!.dispatchEvent(event); });
}
it("preserves the filtered queue origin through a nested record Back link", async () => {
  await render("/pipeline", opportunity); await click();
  await render(opportunity, sub); await click();
  await render(sub, "", true);
  expect(document.querySelector("a")!.getAttribute("href")).toBe(opportunity);
  await click();
  const memory = JSON.parse(saved.get("brostco:navigation:company-a")!);
  expect(memory.returns[opportunity].href).toBe("/pipeline?stage=outreach");
  expect(memory.restore).toBe(opportunity);
  await render(sub, "", true, "company-b");
  expect(document.querySelector("a")!.getAttribute("href")).toBe("/subs");
});
