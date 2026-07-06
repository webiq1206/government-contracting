import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeZip } from "../lib/zip";

describe("makeZip", () => {
  it("produces a valid archive the system unzip can read", () => {
    const entries = [
      { name: "01_cover.txt", data: Buffer.from("hello cover letter", "utf8") },
      { name: "02_pricing.txt", data: Buffer.from("line item,amount\nlabor,1000", "utf8") },
    ];
    const zip = makeZip(entries);
    // Signature check
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);

    const dir = mkdtempSync(join(tmpdir(), "ziptest-"));
    const zipPath = join(dir, "pkg.zip");
    writeFileSync(zipPath, zip);
    // -l lists without extracting; throws (nonzero exit) if the archive is corrupt.
    const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
    expect(listing).toContain("01_cover.txt");
    expect(listing).toContain("02_pricing.txt");

    execFileSync("unzip", ["-o", zipPath, "-d", dir]);
    expect(readFileSync(join(dir, "01_cover.txt"), "utf8")).toBe("hello cover letter");
  });

  it("handles an empty archive", () => {
    const zip = makeZip([]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50); // end-of-central-dir
  });
});
