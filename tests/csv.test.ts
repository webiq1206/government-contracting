/**
 * CSV that a spreadsheet reads back as what we meant.
 *
 * The failure worth guarding is not a broken file — someone would notice
 * that. It is a file that opens cleanly and is wrong.
 */
import { describe, it, expect } from "vitest";
import { csvField, csvRow, toCsv } from "@/lib/domain/csv";

/*
 * Not `.trim()`. String.prototype.trim treats U+FEFF as whitespace and strips
 * the BOM along with the line ending, so a test that trims first can never
 * observe the BOM it is checking for — and would report the code broken while
 * the file Excel receives is perfectly correct.
 */
const dropTrailingNewline = (s: string) => s.replace(/\r\n$/, "");

describe("csvField", () => {
  it("quotes a field containing a comma, so one company does not become two columns", () => {
    expect(csvField("Rivera, Mechanical")).toBe('"Rivera, Mechanical"');
  });

  it("doubles inner quotes", () => {
    expect(csvField('He said "yes"')).toBe('"He said ""yes"""');
  });

  it("quotes a field containing a newline, so later fields stay on their row", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises a formula rather than exporting something Excel will run", () => {
    /*
     * A real path: a subcontractor types this into a form, we store it, an
     * operator exports and opens the file. Prefixing a tab makes the cell
     * unambiguously text — Excel shows the value instead of evaluating it.
     */
    expect(csvField("=1+1")).toBe('"\t=1+1"');
    expect(csvField("+44 20 7946 0000")).toBe('"\t+44 20 7946 0000"');
    expect(csvField("@SUM(A1:A9)")).toBe('"\t@SUM(A1:A9)"');
    expect(csvField("-5")).toBe('"\t-5"');
  });

  it("leaves ordinary values alone", () => {
    expect(csvField("Delta Electric")).toBe("Delta Electric");
    expect(csvField(42)).toBe("42");
  });

  it("writes null and undefined as empty, not as the words", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("emits a BOM and CRLF endings, because the file is opened in Excel", () => {
    const out = toCsv(["Company"], [["Peña Roofing"]]);
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out).toContain("\r\n");
    // The accented name survives, which is the whole point of the BOM.
    expect(out).toContain("Peña Roofing");
  });

  it("keeps every row aligned to its header", () => {
    const out = toCsv(["A", "B"], [["1", "2"], ["3", "4"]]);
    expect(dropTrailingNewline(out).split("\r\n")).toEqual(["\uFEFFA,B", "1,2", "3,4"]);
  });

  it("handles an empty result without producing a stray row", () => {
    expect(dropTrailingNewline(toCsv(["A"], []))).toBe("\uFEFFA");
  });
});

describe("csvRow", () => {
  it("joins fields with commas after quoting each", () => {
    expect(csvRow(["a", "b,c", null])).toBe('a,"b,c",');
  });
});
