import { describe, it, expect } from "vitest";
import {
  diffProfile,
  applicable,
  defaultSelection,
  summarize,
  patchFor,
  verdictLabel,
} from "@/lib/domain/sam-diff";

const CURRENT = {
  legal_name: "Brost Construction LLC",
  uei: "ABC123456789",
  physical_address: "12 Mill Road, Boise ID",
  naics_codes: ["236220", "238210", "238220"],
  certifications: ["SDVOSB"],
};

const INCOMING = {
  legal_name: "Brost Construction LLC",
  dba: "Brost Co",
  uei: "ABC123456789",
  cage_code: "8J4K2",
  physical_address: "12 Mill Rd, Boise, ID 83702",
  naics_codes: ["236220", "238160", "238910"],
  certifications: ["SDVOSB", "HUBZone"],
};

function byKey(key: string) {
  return diffProfile(CURRENT, INCOMING).find((d) => d.key === key)!;
}

describe("diffProfile", () => {
  it("calls an identical value already matching, not a change", () => {
    expect(byKey("legal_name").verdict).toBe("same");
    expect(byKey("uei").verdict).toBe("same");
  });

  it("calls an empty field a fill", () => {
    expect(byKey("dba").verdict).toBe("fill");
    expect(byKey("cage_code").verdict).toBe("fill");
  });

  it("calls a different value a replacement and shows both sides", () => {
    const d = byKey("physical_address");
    expect(d.verdict).toBe("replace");
    expect(d.current).toBe("12 Mill Road, Boise ID");
    expect(d.incoming).toBe("12 Mill Rd, Boise, ID 83702");
  });

  it("says what a list import would actually lose", () => {
    const d = byKey("naics_codes");
    expect(d.verdict).toBe("replace");
    expect(d.kept).toEqual(["236220"]);
    expect(d.removed).toEqual(["238210", "238220"]);
    expect(d.added).toEqual(["238160", "238910"]);
  });

  it("treats a strictly larger list as a replacement, since order and set both change", () => {
    const d = diffProfile(CURRENT, INCOMING).find((x) => x.key === "certifications")!;
    expect(d.verdict).toBe("replace");
    expect(d.removed).toEqual([]);
    expect(d.added).toEqual(["HUBZone"]);
  });

  it("calls an identical list already matching whatever the order", () => {
    const d = diffProfile(
      { naics_codes: ["b", "a"] },
      { naics_codes: ["a", "b"] }
    ).find((x) => x.key === "naics_codes")!;
    expect(d.verdict).toBe("same");
  });

  it("says a field the registration does not carry is absent, never an empty replacement", () => {
    const d = diffProfile(CURRENT, {}).find((x) => x.key === "legal_name")!;
    expect(d.verdict).toBe("absent");
    expect(d.incoming).toBeNull();
    // The dangerous mistake would be treating "SAM has nothing" as "set it to nothing".
    expect(patchFor([d], ["legal_name"], {})).toEqual({});
  });

  it("treats whitespace and empty strings as nothing on either side", () => {
    const d = diffProfile({ dba: "   " }, { dba: "" }).find((x) => x.key === "dba")!;
    expect(d.verdict).toBe("absent");
    expect(d.current).toBeNull();
  });

  it("ignores a non-array where a list belongs rather than throwing", () => {
    const d = diffProfile({ naics_codes: "236220" }, { naics_codes: ["236220"] }).find(
      (x) => x.key === "naics_codes"
    )!;
    expect(d.verdict).toBe("fill");
  });
});

describe("selection", () => {
  const diffs = diffProfile(CURRENT, INCOMING);

  it("offers only the fields that would do something", () => {
    const keys = applicable(diffs).map((d) => d.key);
    expect(keys).toContain("dba");
    expect(keys).toContain("naics_codes");
    expect(keys).not.toContain("legal_name");
    expect(keys).not.toContain("uei");
  });

  it("ticks fills by default and leaves overwrites for the operator to choose", () => {
    const sel = defaultSelection(diffs);
    expect(sel).toContain("dba");
    expect(sel).toContain("cage_code");
    expect(sel).not.toContain("physical_address");
    expect(sel).not.toContain("naics_codes");
  });

  it("summarizes what the current selection would cost", () => {
    const s = summarize(diffs, ["dba", "naics_codes"]);
    expect(s).toEqual({ fills: 1, replaces: 1, losing: 2, empty: false });
  });

  it("knows when the selection would do nothing", () => {
    expect(summarize(diffs, []).empty).toBe(true);
  });

  it("builds a patch of exactly the chosen fields and nothing else", () => {
    const patch = patchFor(diffs, ["dba", "naics_codes"], INCOMING);
    expect(patch).toEqual({ dba: "Brost Co", naics_codes: ["236220", "238160", "238910"] });
  });

  it("will not patch a field that already matches, even if it is ticked", () => {
    expect(patchFor(diffs, ["legal_name", "uei"], INCOMING)).toEqual({});
  });
});

describe("verdictLabel", () => {
  it("says what each verdict means in words rather than a colour", () => {
    expect(verdictLabel("same")).toBe("Already matches");
    expect(verdictLabel("fill")).toBe("Would fill in");
    expect(verdictLabel("replace")).toBe("Would replace");
    expect(verdictLabel("absent")).toBe("Not on the registration");
  });
});
