import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  redirect: (path: string): never => { throw new Error(`redirect:${path}`); },
  notFound: (): never => { throw new Error("not-found"); },
}));
import { rejectOrgPageResponse } from "../lib/org-page-guard";

describe("page organization refusals", () => {
  it.each([[401, "redirect:/login"], [402, "redirect:/settings/billing"],
    [403, "not-found"], [404, "not-found"]])("handles status %s", (status, message) => {
    expect(() => rejectOrgPageResponse(new Response(null, { status: Number(status) })))
      .toThrow(String(message));
  });
  it("keeps an account outage distinct from being signed out", () => {
    expect(() => rejectOrgPageResponse(new Response(null, { status: 503 })))
      .toThrow("Your account could not be loaded");
  });
});
