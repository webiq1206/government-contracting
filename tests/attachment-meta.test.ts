import { describe, it, expect } from "vitest";
import {
  looksLikeDocxBytes,
  normalizeAttachmentMeta,
  sanitizeAttachmentFilename,
} from "../lib/domain/attachment-meta";
import { looksLikePdfBytes } from "../lib/integrations/pdf";
import { buildGmailRawMessage } from "../lib/integrations/gmail";

function pdfFixture(extra = ""): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\n%%EOF\n`);
}

/** Minimal ZIP-like buffer that includes OOXML word/ markers for sniffing. */
function docxLikeFixture(): Buffer {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const marker = Buffer.from("word/document.xml[Content_Types].xml wordprocessingml");
  return Buffer.concat([header, Buffer.alloc(32, 0), marker]);
}

describe("normalizeAttachmentMeta", () => {
  it("turns SAM-style attachment + octet-stream PDF into openable PDF metadata", () => {
    const meta = normalizeAttachmentMeta({
      filename: "attachment",
      mime: "application/octet-stream",
      content: pdfFixture(),
    });
    expect(looksLikePdfBytes(pdfFixture())).toBe(true);
    expect(meta.kind).toBe("pdf");
    expect(meta.filename).toBe("attachment.pdf");
    expect(meta.mime).toBe("application/pdf");
  });

  it("detects DOCX bytes and sets Word MIME + extension", () => {
    const bytes = docxLikeFixture();
    expect(looksLikeDocxBytes(bytes)).toBe(true);
    const meta = normalizeAttachmentMeta({
      filename: "attachment",
      mime: "application/octet-stream",
      content: bytes,
    });
    expect(meta.kind).toBe("docx");
    expect(meta.filename).toBe("attachment.docx");
    expect(meta.mime).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("keeps a correct PDF filename and upgrades a wrong MIME", () => {
    const meta = normalizeAttachmentMeta({
      filename: "Scope of Work.pdf",
      mime: "application/octet-stream",
      content: pdfFixture(),
    });
    expect(meta.filename).toBe("Scope of Work.pdf");
    expect(meta.mime).toBe("application/pdf");
  });

  it("sanitizes dangerous filename characters", () => {
    expect(sanitizeAttachmentFilename('evil\r\n"name.pdf')).toBe("evilname.pdf");
  });
});

describe("buildGmailRawMessage attachments", () => {
  it("embeds base64 attachment parts with PDF Content-Type and filename", () => {
    const pdf = pdfFixture("brostco-test");
    const raw = buildGmailRawMessage(
      {
        to: "sub@example.com",
        subject: "Quote request",
        html: "<p>Hi</p>",
        text: "Hi",
        attachments: [
          {
            filename: "attachment.pdf",
            content: pdf,
            mime: "application/pdf",
          },
        ],
      },
      "BROSTCO <info@brostco.com>"
    );

    const decoded = Buffer.from(
      raw.replace(/-/g, "+").replace(/_/g, "/") + "==",
      "base64"
    ).toString("utf8");

    expect(decoded).toContain("Content-Type: multipart/mixed;");
    expect(decoded).toContain('Content-Type: application/pdf; name="attachment.pdf"');
    expect(decoded).toContain('Content-Disposition: attachment; filename="attachment.pdf"');
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    // Payload must round-trip to the original PDF bytes.
    const b64Match = decoded.match(
      /filename="attachment\.pdf"\r\n\r\n([\s\S]+?)\r\n--brostco_mx_/
    );
    expect(b64Match).toBeTruthy();
    const attached = Buffer.from((b64Match?.[1] ?? "").replace(/\s+/g, ""), "base64");
    expect(attached.equals(pdf)).toBe(true);
  });
});
