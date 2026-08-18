/**
 * Which document the operator is told to sign. A wrong answer here means a
 * wage determination or an instruction sheet gets signed and returned as the
 * offer, so both directions of the match are held down.
 */
import { describe, it, expect } from "vitest";
import { matchOfficialForm, parseFormNumber } from "../lib/domain/official-form";

const file = (name: string) => ({ name, path: `p/${name}` });

describe("parseFormNumber", () => {
  it("reads a form family and number however it is written", () => {
    expect(parseFormNumber("SF-1449")).toEqual({ family: "sf", number: "1449" });
    expect(parseFormNumber("sf 30")).toEqual({ family: "sf", number: "30" });
    expect(parseFormNumber("Standard Form 1442")).toEqual({ family: "sf", number: "1442" });
    expect(parseFormNumber("Optional Form 347")).toEqual({ family: "of", number: "347" });
    expect(parseFormNumber("agency pricing worksheet")).toBeNull();
  });
});

describe("matchOfficialForm", () => {
  it("does not match a longer number that merely starts the same", () => {
    // "sf30" is a prefix of "sf3000", and the old matcher pointed the operator
    // at a wage determination to sign.
    expect(
      matchOfficialForm("SF 30", [file("SF3000_Wage_Determination.pdf")])
    ).toBeNull();
  });

  it("never points at the instruction sheet for a form", () => {
    expect(
      matchOfficialForm("SF-1449", [file("SF1449_Instructions_DO_NOT_SUBMIT.pdf")])
    ).toBeNull();
  });

  it("finds the form when the agency spelled the name out", () => {
    const m = matchOfficialForm("SF-1449", [
      file("Attachment 1 - Scope.pdf"),
      file("Standard Form 1449.pdf"),
    ]);
    expect(m?.name).toBe("Standard Form 1449.pdf");
  });

  it("prefers the real form over its instructions when both are attached", () => {
    const m = matchOfficialForm("SF-1449", [
      file("SF1449_Instructions.pdf"),
      file("SF1449.pdf"),
    ]);
    expect(m?.name).toBe("SF1449.pdf");
  });

  it("matches an agency worksheet by its words", () => {
    const m = matchOfficialForm("agency pricing worksheet Attachment 3", [
      file("Attachment 2 - Wage Determination.pdf"),
      file("Attachment 3 - Pricing Worksheet.xlsx"),
    ]);
    expect(m?.name).toBe("Attachment 3 - Pricing Worksheet.xlsx");
  });

  it("returns nothing rather than a loose guess", () => {
    expect(
      matchOfficialForm("SF-1442", [file("Scope of Work.pdf"), file("Wage Rates.pdf")])
    ).toBeNull();
    expect(matchOfficialForm("", [file("SF1449.pdf")])).toBeNull();
    expect(matchOfficialForm("SF-1449", [{ name: "SF1449.pdf", path: null }])).toBeNull();
  });
});
