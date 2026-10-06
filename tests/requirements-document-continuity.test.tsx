import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RequirementsWorkspace } from "@/components/requirements-workspace";
import type { BriefRequirement } from "@/lib/domain/opportunity-brief";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
let root: Root;
const docs = ["first", "second", "manual"].map(id => ({ id, name: `${id}.pdf`, preview: "pdf" as const, pageCount: 50 }));
const requirements = [
  { id: "anchored", label: "Anchored requirement", sourceDocumentId: "second", sourcePage: 44 },
  { id: "missing", label: "Missing source requirement" },
  { id: "unavailable", label: "Unavailable source requirement", sourceDocumentId: "not-stored", sourcePage: 9 },
  { id: "another", label: "Another page requirement", sourceDocumentId: "second", sourcePage: 12 },
].map(value => ({ importance: "required", owner: "you", disqualifying: false, ...value } as BriefRequirement));
beforeEach(() => {
  const { window } = parseHTML("<html><body><main></main></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.querySelector("main")!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => root.render(<RequirementsWorkspace opportunityId="opp" requirements={requirements}
    states={{}} history={{}} documents={docs} members={[]} canEdit={false} recordHref="/opportunity/opp" />));
}
async function select(label: string) {
  const node = [...document.querySelectorAll("button")].find(node => node.textContent?.includes(label))!;
  await act(async () => node.dispatchEvent(new window.Event("click", { bubbles: true })));
}
async function browse(value: string) {
  const select = document.querySelector("#req-doc")!;
  const key = Object.keys(select).find(key => key.startsWith("__reactProps$"))!;
  const props = (select as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[key];
  await act(async () => props.onChange({ target: { value } }));
}
const src = () => document.querySelector("iframe")?.getAttribute("src");
const fallback = () => [...document.querySelectorAll("a")].find(node => node.textContent?.includes("Open displayed document in new tab"));
it.each(["Missing source requirement", "Unavailable source requirement"])("retains the last visible file without presenting it as proof for %s", async label => {
  await mount(); expect(src()).toBe("/api/documents/second/open?page=44");
  await select(label);
  expect(src()).toBe("/api/documents/second/open");
  expect(fallback()?.getAttribute("href")).toBe("/api/documents/second/open");
  expect(document.body.textContent).toContain("browsing context, not evidence for this requirement");
});
it("keeps a deliberate manual file choice across unavailable sources and follows a later valid citation", async () => {
  await mount(); await browse("manual");
  expect(src()).toBe("/api/documents/manual/open");
  expect(fallback()?.getAttribute("href")).toBe("/api/documents/manual/open");
  await select("Unavailable source requirement"); expect(src()).toBe("/api/documents/manual/open");
  await select("Another page requirement"); expect(src()).toBe("/api/documents/second/open?page=12");
  await select("Anchored requirement"); expect(src()).toBe("/api/documents/second/open?page=44");
});

it("offers a protected new-tab fallback that follows only the displayed PDF and recorded page", async () => {
  await mount();
  expect(fallback()?.getAttribute("href")).toBe("/api/documents/second/open?page=44");
  expect(fallback()?.getAttribute("target")).toBe("_blank");
  expect(fallback()?.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  expect(document.body.textContent).toContain("Page links use the stored citation; verify the text in the document.");
  await select("Another page requirement");
  expect(fallback()?.getAttribute("href")).toBe("/api/documents/second/open?page=12");
});
it("does not invent a file link when no stored document is available", async () => {
  await act(async () => root.render(<RequirementsWorkspace opportunityId="opp" requirements={requirements}
    states={{}} history={{}} documents={[]} members={[]} canEdit={false} recordHref="/opportunity/opp" />));
  expect(fallback()).toBeUndefined();
});
