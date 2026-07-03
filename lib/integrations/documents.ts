/**
 * Document generation — bid packages and capability statements as PDF (pdf-lib)
 * and DOCX (docx). Pure in-process rendering with no external services, so
 * nothing here degrades or throws on missing config. Returns Node Buffers ready
 * to hand to the storage layer.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export interface BidDocData {
  company_name: string;
  opportunity_title: string;
  solicitation_number?: string;
  agency?: string;
  bid_amount: number;
  margin_pct: number;
  line_items?: Array<{ label: string; amount: number }>;
  narrative?: string;
  qa_checklist?: Array<{ item: string; ok: boolean; note?: string }>;
  date?: string;
}

export interface CapabilityData {
  company_name: string;
  uei?: string;
  cage_code?: string;
  naics_codes: string[];
  certifications: string[];
  primary_trades: string[];
  service_areas: string[];
  differentiators?: string[];
  contact?: string;
}

/* ------------------------------- helpers -------------------------------- */

/** Format a number as US currency, e.g. 12345 -> "$12,345.00". */
function currency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `$${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Break `text` into lines that fit within `maxWidth` at the given font/size. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * A tiny cursor-based writer that flows text down a page, adding fresh pages
 * when it runs out of vertical space.
 */
class PdfWriter {
  private page: PDFPage;
  private y: number;

  constructor(private readonly doc: PDFDocument, private readonly fonts: Fonts) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(needed: number): void {
    if (this.y - needed < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  gap(amount: number): void {
    this.y -= amount;
  }

  /** Draw a block of (possibly wrapping) text; returns nothing. */
  text(
    content: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {}
  ): void {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    const color = opts.color ?? [0.1, 0.1, 0.1];
    const lineHeight = size * 1.4;
    const lines = wrapText(content, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: rgb(color[0], color[1], color[2]),
      });
      this.y -= lineHeight;
    }
  }

  /** Section heading with an underline rule. */
  heading(title: string, size = 13): void {
    this.gap(8);
    this.ensureSpace(size * 1.4 + 6);
    this.page.drawText(title, {
      x: MARGIN,
      y: this.y - size,
      size,
      font: this.fonts.bold,
      color: rgb(0.09, 0.24, 0.42),
    });
    this.y -= size * 1.4;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 2 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y + 2 },
      thickness: 0.75,
      color: rgb(0.09, 0.24, 0.42),
    });
    this.y -= 6;
  }

  /** A left label + right-aligned value on one row (used for line items). */
  row(label: string, value: string, opts: { bold?: boolean; size?: number } = {}): void {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const lineHeight = size * 1.5;
    this.ensureSpace(lineHeight);
    const valueWidth = font.widthOfTextAtSize(value, size);
    const maxLabelWidth = CONTENT_WIDTH - valueWidth - 12;
    // Truncate an over-long label so the value stays on the same line.
    let label2 = label;
    while (label2 && font.widthOfTextAtSize(label2, size) > maxLabelWidth) {
      label2 = label2.slice(0, -1);
    }
    if (label2 !== label) label2 = `${label2.slice(0, -1)}…`;
    this.page.drawText(label2, { x: MARGIN, y: this.y - size, size, font });
    this.page.drawText(value, {
      x: PAGE_WIDTH - MARGIN - valueWidth,
      y: this.y - size,
      size,
      font,
    });
    this.y -= lineHeight;
  }

  save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

/* ---------------------------- PDF builders ------------------------------ */

async function makeFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

async function buildBidPdf(data: BidDocData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text("Bid Proposal", { size: 22, bold: true, color: [0.09, 0.24, 0.42] });
  w.gap(4);
  w.text(data.opportunity_title, { size: 14, bold: true });
  w.gap(6);
  w.text(data.company_name, { size: 12 });
  if (data.agency) w.text(`Agency: ${data.agency}`, { size: 11, color: [0.3, 0.3, 0.3] });
  if (data.solicitation_number) {
    w.text(`Solicitation: ${data.solicitation_number}`, { size: 11, color: [0.3, 0.3, 0.3] });
  }
  w.text(`Date: ${data.date ?? todayIso()}`, { size: 11, color: [0.3, 0.3, 0.3] });

  if (data.line_items && data.line_items.length > 0) {
    w.heading("Pricing Breakdown");
    for (const item of data.line_items) {
      w.row(item.label, currency(item.amount));
    }
    w.gap(4);
    w.row("Total Bid Amount", currency(data.bid_amount), { bold: true, size: 12 });
  } else {
    w.heading("Pricing");
    w.row("Total Bid Amount", currency(data.bid_amount), { bold: true, size: 12 });
  }
  w.row("Target Margin", `${data.margin_pct.toFixed(1)}%`, { bold: true });

  if (data.narrative && data.narrative.trim()) {
    w.heading("Experience & Approach");
    w.text(data.narrative);
  }

  if (data.qa_checklist && data.qa_checklist.length > 0) {
    w.heading("Quality Assurance Checklist");
    for (const q of data.qa_checklist) {
      const glyph = q.ok ? "[x]" : "[ ]";
      const line = q.note ? `${glyph} ${q.item} — ${q.note}` : `${glyph} ${q.item}`;
      w.text(line, { size: 11 });
    }
  }

  const bytes = await w.save();
  return Buffer.from(bytes);
}

async function buildCapabilityStatementPdf(data: CapabilityData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text(data.company_name, { size: 22, bold: true, color: [0.09, 0.24, 0.42] });
  w.gap(2);
  w.text("Capability Statement", { size: 13, color: [0.3, 0.3, 0.3] });
  if (data.contact) w.text(data.contact, { size: 11, color: [0.3, 0.3, 0.3] });

  w.heading("Core Competencies");
  if (data.primary_trades.length > 0) {
    for (const trade of data.primary_trades) w.text(`• ${trade}`, { size: 11, indent: 8 });
  } else {
    w.text("—", { size: 11, indent: 8 });
  }

  if (data.differentiators && data.differentiators.length > 0) {
    w.heading("Differentiators");
    for (const d of data.differentiators) w.text(`• ${d}`, { size: 11, indent: 8 });
  }

  w.heading("Past Performance");
  w.text("Available upon request.", { size: 11, color: [0.35, 0.35, 0.35] });

  w.heading("Company Data");
  if (data.uei) w.row("UEI", data.uei);
  if (data.cage_code) w.row("CAGE Code", data.cage_code);
  w.row("NAICS Codes", data.naics_codes.length ? data.naics_codes.join(", ") : "—");
  w.row("Service Areas", data.service_areas.length ? data.service_areas.join(", ") : "—");

  w.heading("Certifications");
  if (data.certifications.length > 0) {
    for (const c of data.certifications) w.text(`• ${c}`, { size: 11, indent: 8 });
  } else {
    w.text("—", { size: 11, indent: 8 });
  }

  const bytes = await w.save();
  return Buffer.from(bytes);
}

/* ---------------------------- DOCX builder ------------------------------ */

async function buildBidDocx(data: BidDocData): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: "Bid Proposal", bold: true })],
    })
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: data.opportunity_title })],
    })
  );
  children.push(new Paragraph({ children: [new TextRun({ text: data.company_name, size: 24 })] }));
  if (data.agency) {
    children.push(new Paragraph({ children: [new TextRun({ text: `Agency: ${data.agency}` })] }));
  }
  if (data.solicitation_number) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Solicitation: ${data.solicitation_number}` })],
      })
    );
  }
  children.push(
    new Paragraph({ children: [new TextRun({ text: `Date: ${data.date ?? todayIso()}` })] })
  );

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: "Pricing Breakdown", bold: true })],
    })
  );
  if (data.line_items && data.line_items.length > 0) {
    for (const item of data.line_items) {
      children.push(
        new Paragraph({
          tabStops: [{ type: "right", position: 9000 }],
          children: [new TextRun({ text: `${item.label}\t${currency(item.amount)}` })],
        })
      );
    }
  }
  children.push(
    new Paragraph({
      tabStops: [{ type: "right", position: 9000 }],
      children: [
        new TextRun({ text: `Total Bid Amount\t${currency(data.bid_amount)}`, bold: true }),
      ],
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Target Margin: ${data.margin_pct.toFixed(1)}%`, bold: true })],
    })
  );

  if (data.narrative && data.narrative.trim()) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Experience & Approach", bold: true })],
      })
    );
    for (const para of data.narrative.split("\n")) {
      children.push(new Paragraph({ children: [new TextRun({ text: para })] }));
    }
  }

  if (data.qa_checklist && data.qa_checklist.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Quality Assurance Checklist", bold: true })],
      })
    );
    for (const q of data.qa_checklist) {
      const glyph = q.ok ? "☒" : "☐";
      const text = q.note ? `${glyph} ${q.item} — ${q.note}` : `${glyph} ${q.item}`;
      children.push(new Paragraph({ children: [new TextRun({ text })] }));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

export const documents = {
  buildBidPdf,
  buildBidDocx,
  buildCapabilityStatementPdf,
};
