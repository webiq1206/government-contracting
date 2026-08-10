/**
 * Document generation, bid packages and capability statements as PDF (pdf-lib)
 * and DOCX (docx). Pure in-process rendering with no external services, so
 * nothing here degrades or throws on missing config. Returns Node Buffers ready
 * to hand to the storage layer.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { noEmDash, deepNoEmDash } from "../sanitize";

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
    // Hard rule: no em dashes in any generated document.
    const lines = wrapText(noEmDash(content), font, size, CONTENT_WIDTH - indent);
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
  heading(rawTitle: string, size = 13): void {
    const title = noEmDash(rawTitle);
    this.gap(8);
    this.ensureSpace(size * 1.4 + 6);
    this.page.drawText(title, {
      x: MARGIN,
      y: this.y - size,
      size,
      font: this.fonts.bold,
      color: rgb(0.141, 0.141, 0.141), // brand charcoal #242424
    });
    this.y -= size * 1.4;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 2 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y + 2 },
      thickness: 0.75,
      color: rgb(0.698, 0.561, 0.365), // brand gold #B28F5D
    });
    this.y -= 6;
  }

  /** A left label + right-aligned value on one row (used for line items). */
  row(rawLabel: string, rawValue: string, opts: { bold?: boolean; size?: number } = {}): void {
    const label = noEmDash(rawLabel);
    const value = noEmDash(rawValue);
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

  w.text("Bid Proposal", { size: 22, bold: true, color: [0.141, 0.141, 0.141] });
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
      const line = q.note ? `${glyph} ${q.item}, ${q.note}` : `${glyph} ${q.item}`;
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

  w.text(data.company_name, { size: 22, bold: true, color: [0.141, 0.141, 0.141] });
  w.gap(2);
  w.text("Capability Statement", { size: 13, color: [0.3, 0.3, 0.3] });
  if (data.contact) w.text(data.contact, { size: 11, color: [0.3, 0.3, 0.3] });

  w.heading("Core Competencies");
  if (data.primary_trades.length > 0) {
    for (const trade of data.primary_trades) w.text(`• ${trade}`, { size: 11, indent: 8 });
  } else {
    w.text("-", { size: 11, indent: 8 });
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
  w.row("NAICS Codes", data.naics_codes.length ? data.naics_codes.join(", ") : "-");
  w.row("Service Areas", data.service_areas.length ? data.service_areas.join(", ") : "-");

  w.heading("Certifications");
  if (data.certifications.length > 0) {
    for (const c of data.certifications) w.text(`• ${c}`, { size: 11, indent: 8 });
  } else {
    w.text("-", { size: 11, indent: 8 });
  }

  const bytes = await w.save();
  return Buffer.from(bytes);
}

/* ---------------------------- DOCX builder ------------------------------ */

async function buildBidDocx(rawData: BidDocData): Promise<Buffer> {
  // Hard rule: no em dashes in any generated document.
  const data = deepNoEmDash(rawData);
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
      const text = q.note ? `${glyph} ${q.item}, ${q.note}` : `${glyph} ${q.item}`;
      children.push(new Paragraph({ children: [new TextRun({ text })] }));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

/* ------------------- submission-package document builders ------------------ */

export interface CoverLetterData {
  company_name: string;
  company_address?: string;
  company_contact?: string; // "Name, Title · phone · email"
  agency?: string;
  opportunity_title: string;
  solicitation_number?: string;
  bid_amount: number;
  contents: string[]; // what's enclosed, in order
  date?: string;
}

/** Transmittal / cover letter that fronts the submission package. */
async function buildCoverLetterPdf(data: CoverLetterData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text(data.company_name, { size: 18, bold: true, color: [0.141, 0.141, 0.141] });
  if (data.company_address) w.text(data.company_address, { size: 10, color: [0.35, 0.35, 0.35] });
  if (data.company_contact) w.text(data.company_contact, { size: 10, color: [0.35, 0.35, 0.35] });
  w.gap(10);
  w.text(data.date ?? todayIso(), { size: 11 });
  w.gap(8);
  if (data.agency) w.text(data.agency, { size: 11 });
  w.text(
    `Re: ${data.opportunity_title}${data.solicitation_number ? ` (Solicitation ${data.solicitation_number})` : ""}`,
    { size: 11, bold: true }
  );
  w.gap(10);
  w.text("To the Contracting Officer:", { size: 11 });
  w.gap(6);
  w.text(
    `${data.company_name} is pleased to submit the enclosed offer in response to the above solicitation. Our total proposed price is ${currency(data.bid_amount)}. We have reviewed the solicitation and its attachments and affirm our intent to perform in full accordance with its terms.`,
    { size: 11 }
  );
  w.gap(6);
  w.text("The following documents are enclosed as part of this submission:", { size: 11 });
  w.gap(2);
  for (const c of data.contents) w.text(`•  ${c}`, { size: 11, indent: 10 });
  w.gap(10);
  w.text("We appreciate the opportunity to bid and welcome any questions.", { size: 11 });
  w.gap(16);
  w.text("Respectfully submitted,", { size: 11 });
  w.gap(28);
  w.text("_______________________________", { size: 11 });
  w.text(data.company_contact ?? data.company_name, { size: 11 });

  return Buffer.from(await w.save());
}

export interface PricingScheduleData {
  company_name: string;
  opportunity_title: string;
  solicitation_number?: string;
  line_items: Array<{ label: string; amount: number }>;
  bid_amount: number;
  date?: string;
}

/** Itemized pricing / bid schedule with a signature block. */
async function buildPricingSchedulePdf(data: PricingScheduleData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text("Pricing Schedule", { size: 20, bold: true, color: [0.141, 0.141, 0.141] });
  w.gap(2);
  w.text(data.opportunity_title, { size: 12, bold: true });
  if (data.solicitation_number) {
    w.text(`Solicitation: ${data.solicitation_number}`, { size: 10, color: [0.35, 0.35, 0.35] });
  }
  w.text(`Offeror: ${data.company_name}`, { size: 10, color: [0.35, 0.35, 0.35] });
  w.text(`Date: ${data.date ?? todayIso()}`, { size: 10, color: [0.35, 0.35, 0.35] });

  w.heading("Itemized Pricing");
  if (data.line_items.length > 0) {
    for (const item of data.line_items) w.row(item.label, currency(item.amount));
  } else {
    w.text("No line items provided.", { size: 11, color: [0.35, 0.35, 0.35] });
  }
  w.gap(4);
  w.row("TOTAL PROPOSED PRICE", currency(data.bid_amount), { bold: true, size: 13 });

  w.gap(24);
  w.text(
    "The undersigned certifies that the pricing above is firm and complete for the full scope of the solicitation.",
    { size: 10, color: [0.35, 0.35, 0.35] }
  );
  w.gap(24);
  w.row("Authorized signature: ____________________________", "Date: ______________", { size: 11 });

  return Buffer.from(await w.save());
}

export interface RepsAndCertsData {
  legal_name: string;
  dba?: string;
  physical_address?: string;
  uei?: string;
  cage_code?: string;
  duns?: string;
  ein?: string;
  entity_state?: string;
  business_structure?: string;
  small_business: boolean;
  certifications: string[];
  naics_codes: string[];
  owner_name?: string;
  owner_title?: string;
  phone?: string;
  email?: string;
  solicitation_number?: string;
}

/**
 * A pre-filled Representations & Certifications data sheet. Every field the
 * platform knows is filled from the Company Profile; the attestation and
 * signature are left for the operator (these are legal statements only a person
 * may make).
 */
async function buildRepsAndCertsPdf(data: RepsAndCertsData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text("Representations & Certifications", { size: 18, bold: true, color: [0.141, 0.141, 0.141] });
  w.text("Offeror data sheet, pre-filled for review and signature", {
    size: 10,
    color: [0.35, 0.35, 0.35],
  });
  if (data.solicitation_number) {
    w.text(`Solicitation: ${data.solicitation_number}`, { size: 10, color: [0.35, 0.35, 0.35] });
  }

  w.heading("Offeror Identification");
  w.row("Legal business name", data.legal_name || "-");
  if (data.dba) w.row("Doing business as (DBA)", data.dba);
  w.row("Physical address", data.physical_address || "-");
  w.row("UEI", data.uei || "-");
  w.row("CAGE code", data.cage_code || "-");
  if (data.duns) w.row("DUNS", data.duns);
  w.row("Taxpayer ID (EIN)", data.ein || "-");
  w.row("State of incorporation", data.entity_state || "-");
  w.row("Business structure", data.business_structure || "-");

  w.heading("Size & Socioeconomic Status");
  w.row("Small business", data.small_business ? "Yes" : "No");
  w.row(
    "Certifications held",
    data.certifications.length ? data.certifications.join(", ") : "None on file"
  );
  w.row("Primary NAICS codes", data.naics_codes.length ? data.naics_codes.join(", ") : "-");

  w.heading("Representation Statement");
  w.text(
    "By signing below, the offeror certifies that the information above is current, accurate, and complete, and adopts the representations and certifications applicable to this solicitation (including those incorporated by reference in SAM.gov).",
    { size: 10 }
  );

  w.gap(20);
  w.row(`Authorized signature: ____________________________`, "Date: ______________", { size: 11 });
  w.gap(6);
  w.text(
    `Name / Title: ${[data.owner_name, data.owner_title].filter(Boolean).join(", ") || "____________________________"}`,
    { size: 11 }
  );
  if (data.phone || data.email) {
    w.text(`Contact: ${[data.phone, data.email].filter(Boolean).join(" · ")}`, { size: 10, color: [0.35, 0.35, 0.35] });
  }
  w.gap(10);
  w.text("REQUIRES SIGNATURE BEFORE SUBMISSION.", { size: 10, bold: true, color: [0.7, 0.33, 0.03] });

  return Buffer.from(await w.save());
}

export interface ComplianceMatrixDoc {
  opportunity_title: string;
  solicitation_number?: string;
  company_name: string;
  rows: Array<{
    title: string;
    status: string; // human label
    mandatory: boolean;
    source: string;
    note?: string;
  }>;
  date?: string;
}

/** A checklist cover page listing every requirement and its status. */
async function buildComplianceMatrixPdf(data: ComplianceMatrixDoc): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text("Submission Compliance Checklist", { size: 18, bold: true, color: [0.141, 0.141, 0.141] });
  w.text(data.opportunity_title, { size: 12, bold: true });
  if (data.solicitation_number) {
    w.text(`Solicitation: ${data.solicitation_number}`, { size: 10, color: [0.35, 0.35, 0.35] });
  }
  w.text(`Offeror: ${data.company_name} · ${data.date ?? todayIso()}`, {
    size: 10,
    color: [0.35, 0.35, 0.35],
  });

  w.heading("Required items");
  for (const r of data.rows) {
    const box = r.status.toLowerCase().includes("satisf") ? "[x]" : "[ ]";
    w.text(`${box} ${r.title}${r.mandatory ? "" : "  (optional)"}`, { size: 11, bold: true });
    const detail = [r.status, r.source, r.note].filter(Boolean).join(" · ");
    if (detail) w.text(detail, { size: 9, indent: 18, color: [0.4, 0.4, 0.4] });
  }

  return Buffer.from(await w.save());
}

export interface AmendmentAckData {
  company_name: string;
  opportunity_title: string;
  solicitation_number?: string;
  amendments: Array<{ label: string; date?: string; summary?: string }>;
  date?: string;
}

/** Amendment / addendum acknowledgment form with a signature block. */
async function buildAmendmentAckPdf(data: AmendmentAckData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = await makeFonts(doc);
  const w = new PdfWriter(doc, fonts);

  w.text("Acknowledgment of Amendments", { size: 18, bold: true, color: [0.141, 0.141, 0.141] });
  w.text(data.opportunity_title, { size: 12, bold: true });
  if (data.solicitation_number) {
    w.text(`Solicitation: ${data.solicitation_number}`, { size: 10, color: [0.35, 0.35, 0.35] });
  }
  w.text(`Offeror: ${data.company_name} · ${data.date ?? todayIso()}`, {
    size: 10,
    color: [0.35, 0.35, 0.35],
  });

  w.heading("The offeror acknowledges receipt of the following amendments");
  if (data.amendments.length > 0) {
    for (const a of data.amendments) {
      w.text(`•  ${a.label}${a.date ? ` (${a.date})` : ""}`, { size: 11, bold: true, indent: 6 });
      if (a.summary) w.text(a.summary, { size: 9, indent: 18, color: [0.4, 0.4, 0.4] });
    }
  } else {
    w.text("No amendments were issued for this solicitation.", {
      size: 11,
      color: [0.35, 0.35, 0.35],
    });
  }

  w.gap(24);
  w.row("Authorized signature: ____________________________", "Date: ______________", { size: 11 });
  w.gap(10);
  w.text("REQUIRES SIGNATURE BEFORE SUBMISSION.", { size: 10, bold: true, color: [0.7, 0.33, 0.03] });

  return Buffer.from(await w.save());
}

export const documents = {
  buildBidPdf,
  buildBidDocx,
  buildCapabilityStatementPdf,
  buildCoverLetterPdf,
  buildPricingSchedulePdf,
  buildRepsAndCertsPdf,
  buildComplianceMatrixPdf,
  buildAmendmentAckPdf,
};
