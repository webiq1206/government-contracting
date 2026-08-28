import { describe, it, expect } from "vitest";
import { professionalStem, uniqueFilename } from "../lib/domain/attachment-naming";

describe("professionalStem", () => {
  it("drops exhibit numbering when something descriptive remains", () => {
    expect(professionalStem("Attachment_2._Wage_Determination.pdf")).toBe(
      "Wage Determination"
    );
    expect(professionalStem("Attachment_5_Pricing_Schedule.docx")).toBe(
      "Pricing Schedule"
    );
    expect(professionalStem("Attachment_11._Questions_and_Answers.pdf")).toBe(
      "Questions and Answers"
    );
    expect(professionalStem("Attachment_10._Section_H.pdf")).toBe("Section H");
  });

  it("drops a leading notice number when real words follow it", () => {
    expect(professionalStem("FA466126Q0027P00001_-_Amendment_1.pdf")).toBe(
      "Amendment 1"
    );
  });

  it("expands the shorthand a subcontractor should not need to know", () => {
    expect(
      professionalStem("Attachment_6._Dyess_AFB_Vindicator_IDIQ_SOW_CAO_17_Jul_2026.pdf")
    ).toBe("Dyess AFB Vindicator IDIQ Statement of Work CAO 17 Jul 2026");
    expect(professionalStem("PWS_Grounds_Maintenance.pdf")).toBe(
      "Performance Work Statement Grounds Maintenance"
    );
  });

  it("repairs percent-mangled punctuation", () => {
    expect(
      professionalStem(
        "Attachment_8._Statement_of_Work_E2_80_93_Project_2_E2_80_93_7318_26_4320.pdf"
      )
    ).toBe("Statement of Work - Project 2 - 7318 26 4320");
    expect(professionalStem("Attachment_3._Brand_Name_J_26A_28Redacted_29.pdf")).toBe(
      "Brand Name J&A (Redacted)"
    );
  });

  it("leaves real numbers alone: not every 26 was an ampersand", () => {
    expect(professionalStem("Buildings_25_26_27_Floor_Plan.pdf")).toBe(
      "Buildings 25 26 27 Floor Plan"
    );
  });

  it("normalises shouting and lowercase without wrecking acronyms", () => {
    expect(professionalStem("WAGE_DETERMINATION_2015-4281.pdf")).toBe(
      "Wage Determination 2015-4281"
    );
    expect(professionalStem("site visit instructions.pdf")).toBe(
      "Site Visit Instructions"
    );
  });

  it("manufactures a name from what the document is when nothing survives", () => {
    expect(
      professionalStem("attachment.pdf", { documentClass: "wage_determination" })
    ).toBe("Wage Determination");
    expect(
      professionalStem("attachment 3.pdf", { documentClass: "amendment", amendmentNumber: 2 })
    ).toBe("Amendment 2");
    expect(
      professionalStem("FA466126Q0027.pdf", { documentClass: "solicitation" })
    ).toBe("Solicitation FA466126Q0027");
    expect(
      professionalStem("document.pdf", { solicitationNumber: "FA466126Q0027", index: 3 })
    ).toBe("FA466126Q0027 Bid Document 3");
  });

  it("keeps a bare notice id visible rather than calling it a document", () => {
    expect(professionalStem("FA466126Q0027.pdf")).toBe(
      "Solicitation Document FA466126Q0027"
    );
  });

  it("never returns something a mail client cannot show", () => {
    expect(professionalStem("")).toBe("Bid Document");
    const long = professionalStem(`${"Very Long Descriptive Name ".repeat(10)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(100);
  });
});

describe("uniqueFilename", () => {
  it("suffixes the second and third of a name, case-insensitively", () => {
    const taken = new Set<string>();
    expect(uniqueFilename("Wage Determination.pdf", taken)).toBe("Wage Determination.pdf");
    expect(uniqueFilename("wage determination.pdf", taken)).toBe(
      "wage determination (2).pdf"
    );
    expect(uniqueFilename("Wage Determination.pdf", taken)).toBe(
      "Wage Determination (3).pdf"
    );
  });
});
