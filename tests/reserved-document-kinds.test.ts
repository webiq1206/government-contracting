/**
 * The document slots the package builder owns.
 *
 * `storeDoc` clears a slot before writing it: `delete from documents where
 * opportunity_id = $1 and kind = $2`. That is correct for a regenerated
 * artifact and destructive for anything else, so a file uploaded under one of
 * those names is deleted by the next package build, silently, with no copy
 * left. The upload route takes `kind` from the request, so the only thing
 * standing between an operator's signed bid bond and that delete was the
 * interface happening never to send a colliding value.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ARTIFACT_KIND, RESERVED_KINDS } from "@/lib/domain/package";

describe("kinds an upload may not claim", () => {
  it("covers every artifact the builder generates", () => {
    // Derived rather than listed, so a new artifact kind is reserved the day
    // it is added instead of the day somebody remembers this file.
    expect([...RESERVED_KINDS].sort()).toEqual(Object.values(ARTIFACT_KIND).sort());
  });

  it("does not reserve the kinds the interface actually sends", () => {
    for (const kind of ["operator_upload", "requirement_document", "solicitation"]) {
      expect(RESERVED_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it("is enforced by the upload route", () => {
    const route = readFileSync("app/api/opportunities/[id]/documents/route.ts", "utf8");
    expect(route).toContain("RESERVED_KINDS");
    // Refused outright: storing it under a mangled name would leave the
    // operator a file they cannot find under a type they did not choose.
    expect(route).toContain("status: 400");
  });

  it("names the slots the builder clears", () => {
    /*
     * If storeDoc stops deleting first, this reservation becomes unnecessary
     * restriction rather than protection, and should be reconsidered rather
     * than left in place because it is already written.
     */
    const builder = readFileSync("lib/agents/package-builder.ts", "utf8");
    expect(builder).toContain("delete from documents where opportunity_id = $1 and kind = $2");
  });
});
