/**
 * The document slots the package builder owns.
 *
 * Generated artifact kinds are platform-owned. They remain reserved so an
 * operator upload cannot impersonate a generated file in the package, even
 * though package builds now write immutable versioned objects rather than
 * deleting the previous object first.
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

  it("writes a new immutable object version and never deletes from the renderer", () => {
    const builder = readFileSync("lib/agents/package-builder.ts", "utf8");
    expect(builder).toContain("/${buildToken}/${kind}.pdf");
    expect(builder).toContain("content_hash");
    expect(builder).not.toMatch(/delete\s+from\s+documents/i);
  });
});
