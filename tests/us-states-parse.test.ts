import { describe, it, expect } from "vitest";
import { stateCodeFromAddress, stateCodeFromText } from "@/lib/us-states";

// These two parsers gate WHERE subcontractors are sourced. A wrong answer
// here pairs a firm from the wrong side of the country with a job, so the
// contract is: return the state only when the text clearly names one, and
// null the moment it is ambiguous.
describe("reading a state from a Google formatted address", () => {
  it("reads the standard address shape", () => {
    expect(stateCodeFromAddress("123 Marine Corps Dr, Yigo, GU 96929, United States")).toBe("GU");
    expect(stateCodeFromAddress("456 W Main St, Boise, ID 83702, USA")).toBe("ID");
  });

  it("reads a zip+4 and a missing country", () => {
    expect(stateCodeFromAddress("789 Elm St, Austin, TX 78701-4321")).toBe("TX");
  });

  it("reads a stateless-zip form ending in the state", () => {
    expect(stateCodeFromAddress("22 Ocean View, Tamuning, GU")).toBe("GU");
    expect(stateCodeFromAddress("22 Ocean View, Tamuning, GU, United States")).toBe("GU");
  });

  it("never reads a street word as a state", () => {
    // "ID" inside a street name must not read as Idaho.
    expect(stateCodeFromAddress("10 ID Boulevard")).toBeNull();
  });

  it("returns null for foreign or unparseable addresses", () => {
    expect(stateCodeFromAddress("1-2-3 Shibuya, Tokyo 150-0002, Japan")).toBeNull();
    expect(stateCodeFromAddress("")).toBeNull();
    expect(stateCodeFromAddress(null)).toBeNull();
  });
});

describe("reading a state from free text", () => {
  it("reads a state name", () => {
    expect(stateCodeFromText("Andersen AFB, Guam")).toBe("GU");
    expect(stateCodeFromText("work is at Fort Bliss, Texas")).toBe("TX");
  });

  it("reads a bare code as its own token", () => {
    expect(stateCodeFromText("Yigo, GU 96929")).toBe("GU");
  });

  it("does not double-read West Virginia as Virginia", () => {
    expect(stateCodeFromText("Charleston, West Virginia")).toBe("WV");
  });

  it("refuses a multi-state area rather than guessing", () => {
    expect(stateCodeFromText("sites in Texas and Oklahoma")).toBeNull();
  });

  it("refuses text with no state at all", () => {
    expect(stateCodeFromText("the installation's east campus")).toBeNull();
    expect(stateCodeFromText("")).toBeNull();
    expect(stateCodeFromText(null)).toBeNull();
  });
});
