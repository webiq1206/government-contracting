/**
 * Whether the documents on a quote request can actually be opened.
 *
 * The gatherer's failure mode is silence: an empty download is skipped, a file
 * that lost its name is attached as "attachment.pdf", an encrypted PDF is sent
 * to someone who has no password. In every case the email goes out looking
 * complete, and the first sign of trouble is a reply asking for the drawings,
 * or no reply at all.
 */
import { describe, it, expect } from "vitest";
import {
  assessAttachmentPackage,
  looksCorrupt,
  looksGenericName,
  looksPasswordProtected,
  amendmentOf,
  describePackageProblems,
} from "@/lib/domain/attachment-package";

const pdf = (extra = "") => Buffer.from(`%PDF-1.7\n${extra}`);

describe("looksCorrupt", () => {
  it("passes a real PDF", () => {
    expect(looksCorrupt({ filename: "Drawings.pdf", content: pdf(), mime: "application/pdf" })).toBe(
      false
    );
  });

  it("catches an HTML error page saved as a PDF", () => {
    /*
     * The common shape: a storage or SAM fetch returned a 403 page, and it was
     * stored under the document's name. It attaches cleanly and opens to
     * nothing.
     */
    expect(
      looksCorrupt({
        filename: "Drawings.pdf",
        content: Buffer.from("<!DOCTYPE html><html><body>Forbidden"),
        mime: "application/pdf",
      })
    ).toBe(true);
  });

  it("checks Office files by their zip container", () => {
    expect(
      looksCorrupt({ filename: "Schedule.xlsx", content: Buffer.from("PKrest") })
    ).toBe(false);
    expect(looksCorrupt({ filename: "Schedule.xlsx", content: Buffer.from("not a zip") })).toBe(
      true
    );
  });

  it("judges nothing when the bytes were never downloaded", () => {
    // A link-only entry has no content here; absence is not corruption.
    expect(looksCorrupt({ filename: "Drawings.pdf" })).toBe(false);
  });

  it("has no opinion on a type it does not know", () => {
    expect(looksCorrupt({ filename: "site-photo.heic", content: Buffer.from("xx") })).toBe(false);
  });
});

describe("looksPasswordProtected", () => {
  it("catches an encrypted PDF", () => {
    expect(
      looksPasswordProtected({
        filename: "Wage Determination.pdf",
        content: pdf("trailer\n<< /Encrypt 12 0 R /Root 1 0 R >>"),
        mime: "application/pdf",
      })
    ).toBe(true);
  });

  it("leaves an ordinary PDF alone", () => {
    expect(looksPasswordProtected({ filename: "SOW.pdf", content: pdf("/Root 1 0 R") })).toBe(false);
  });

  it("does not guess about non-PDFs", () => {
    expect(
      looksPasswordProtected({ filename: "notes.txt", content: Buffer.from("/Encrypt") })
    ).toBe(false);
  });
});

describe("looksGenericName", () => {
  it("catches the names that tell a recipient nothing", () => {
    for (const n of ["attachment.pdf", "document.pdf", "file1.pdf", "Untitled.docx", "scan_02.pdf"]) {
      expect(looksGenericName(n), n).toBe(true);
    }
  });

  it("keeps a name that says what the document is", () => {
    for (const n of ["Statement of Work.pdf", "Wage Determination.pdf", "M-101 Mechanical.pdf"]) {
      expect(looksGenericName(n), n).toBe(false);
    }
  });
});

describe("amendmentOf", () => {
  it("reads a revision number", () => {
    expect(amendmentOf("Drawings Rev 2.pdf")?.number).toBe(2);
    expect(amendmentOf("SOW_Amendment_3.pdf")?.number).toBe(3);
  });

  it("treats an unnumbered amendment as the first", () => {
    expect(amendmentOf("SOW Amended.pdf")?.number).toBe(1);
  });

  it("says nothing about a document that is not a revision", () => {
    expect(amendmentOf("Statement of Work.pdf")).toBeNull();
  });
});

const OK_FILES = [
  { filename: "Statement of Work.pdf", content: pdf(), mime: "application/pdf" },
  { filename: "Wage Determination.pdf", content: pdf(), mime: "application/pdf" },
];

describe("assessAttachmentPackage", () => {
  it("passes a clean package", () => {
    const r = assessAttachmentPackage({ files: OK_FILES, links: [], expected: true });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.deliveredNames).toEqual(["Statement of Work.pdf", "Wage Determination.pdf"]);
  });

  it("blocks on an empty file rather than skipping it", () => {
    /*
     * The gatherer's `if (!bytes.length) continue` is exactly this case, and
     * it produced an email whose document list was one line shorter than it
     * should have been, with nothing anywhere saying so.
     */
    const r = assessAttachmentPackage({
      files: [...OK_FILES, { filename: "Drawings.pdf", content: Buffer.alloc(0) }],
      links: [],
      expected: true,
    });
    expect(r.ok).toBe(false);
    expect(r.problems[0].kind).toBe("empty_file");
    expect(r.deliveredNames).not.toContain("Drawings.pdf");
  });

  it("blocks on a file that will not open", () => {
    const r = assessAttachmentPackage({
      files: [{ filename: "Drawings.pdf", content: Buffer.from("<html>403"), mime: "application/pdf" }],
      links: [],
      expected: true,
    });
    expect(r.problems.some((p) => p.kind === "corrupt_file")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("blocks on a password-protected file", () => {
    const r = assessAttachmentPackage({
      files: [{ filename: "SOW.pdf", content: pdf("/Encrypt 4 0 R"), mime: "application/pdf" }],
      links: [],
      expected: true,
    });
    expect(r.problems[0].kind).toBe("password_protected");
    expect(r.ok).toBe(false);
  });

  it("blocks on the same document attached twice", () => {
    const r = assessAttachmentPackage({
      files: [OK_FILES[0], { ...OK_FILES[0], filename: "statement_of_work.pdf" }],
      links: [],
      expected: true,
    });
    expect(r.problems[0].kind).toBe("duplicate");
    expect(r.deliveredNames).toHaveLength(1);
  });

  it("warns about a useless filename without holding the email", () => {
    // The document is intact; blocking the whole request over its name would
    // cost more than it saves.
    const r = assessAttachmentPackage({
      files: [{ filename: "attachment.pdf", content: pdf() }],
      links: [],
      expected: true,
    });
    expect(r.ok).toBe(true);
    expect(r.problems[0].kind).toBe("generic_filename");
    expect(r.problems[0].blocking).toBe(false);
  });

  it("blocks on a document we know about and could not deliver", () => {
    /*
     * The distinction the whole module turns on: a subcontractor cannot tell a
     * document that was not sent from one that does not exist.
     */
    const r = assessAttachmentPackage({
      files: OK_FILES,
      links: [],
      expected: true,
      undelivered: [{ name: "Drawings M-101.pdf", reason: "storage returned 500" }],
    });
    expect(r.ok).toBe(false);
    expect(describePackageProblems(r.problems)).toMatch(/Drawings M-101/);
  });

  it("counts a link as delivery, because it is", () => {
    const r = assessAttachmentPackage({
      files: [],
      links: [{ name: "Full document package", url: "https://brostco.test/d/abc" }],
      expected: true,
    });
    expect(r.ok).toBe(true);
    expect(r.deliveredNames).toEqual(["Full document package"]);
  });

  it("blocks when a document-bearing solicitation delivers nothing", () => {
    const r = assessAttachmentPackage({ files: [], links: [], expected: true });
    expect(r.problems[0].kind).toBe("nothing_delivered");
    expect(r.ok).toBe(false);
  });

  it("is content with a solicitation that genuinely has no documents", () => {
    const r = assessAttachmentPackage({ files: [], links: [], expected: false });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("flags two revisions of one document without blocking", () => {
    // Often correct, and sometimes required. The operator should know the
    // recipient has to work out which one governs.
    const r = assessAttachmentPackage({
      files: [
        { filename: "Drawings Rev 1.pdf", content: pdf() },
        { filename: "Drawings Rev 2.pdf", content: pdf() },
      ],
      links: [],
      expected: true,
    });
    expect(r.ok).toBe(true);
    expect(r.problems.some((p) => p.kind === "superseded_only")).toBe(true);
  });

  it("reports every problem, not only the first", () => {
    const r = assessAttachmentPackage({
      files: [
        { filename: "attachment.pdf", content: pdf() },
        { filename: "Empty.pdf", content: Buffer.alloc(0) },
      ],
      links: [],
      expected: true,
      undelivered: [{ name: "Specs.pdf", reason: "timeout" }],
    });
    expect(r.problems.map((p) => p.kind).sort()).toEqual(
      ["download_failed", "empty_file", "generic_filename"].sort()
    );
  });
});

describe("the package link", () => {
  it("blocks the send when the link does not resolve", () => {
    /*
     * The one thing in the email nobody checks before it goes, and the only
     * route to documents too large to attach. A dead link is worse than none:
     * the recipient believes the drawings were provided and blames themselves
     * for not finding them.
     */
    const r = assessAttachmentPackage({
      files: OK_FILES,
      links: [
        { name: "All 6 bid documents", url: "https://brostco.test/d/x", reachable: false },
      ],
      expected: true,
    });
    expect(r.ok).toBe(false);
    expect(r.problems[0].kind).toBe("unreachable_link");
  });

  it("accepts a link that was checked and works", () => {
    expect(
      assessAttachmentPackage({
        files: [],
        links: [{ name: "All 6 bid documents", url: "https://brostco.test/d/x", reachable: true }],
        expected: true,
      }).ok
    ).toBe(true);
  });

  it("does not block a link nobody checked", () => {
    // A caller that cannot verify should not be forced to hold a send; only
    // an explicit failure stops the email.
    expect(
      assessAttachmentPackage({
        files: [],
        links: [{ name: "Full packet", url: "https://brostco.test/d/x" }],
        expected: true,
      }).ok
    ).toBe(true);
  });
});
