/**
 * IRS Form W-9, as something a subcontractor fills in and signs on screen.
 *
 * This module is deliberately pure: shapes, validation, formatting, and the
 * exact text a signer agrees to. No database, no crypto, no storage. That is
 * what makes the rules testable, and the rules are the part that has to be
 * right, because a W-9 is signed under penalty of perjury.
 *
 * Two consequences of that last sentence run through everything here:
 *
 *   - Only the taxpayer may sign. Staff can chase a W-9, upload a certificate
 *     of insurance, and verify what arrives, but they can never sign this form
 *     on a subcontractor's behalf. The portal exists for exactly this reason.
 *   - The certification wording is versioned. The IRS revises the form, and a
 *     signature only means something if we can still produce the precise text
 *     that was on screen when it was given.
 *
 * The certification text below is reproduced from IRS Form W-9 (Rev. March
 * 2024). IRS forms are US Government works and carry no copyright; a
 * substitute W-9 is required to use this language verbatim.
 */

/** Bump when the certification wording below changes, never retroactively. */
export const W9_CERTIFICATION_VERSION = "irs-w9-rev-2024-03";

/** The perjury certification, verbatim. Shown whole, never summarized. */
export const W9_CERTIFICATION: readonly string[] = [
  "The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and",
  "I am not subject to backup withholding because (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and",
  "I am a U.S. citizen or other U.S. person; and",
  "The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.",
];

export const W9_CERTIFICATION_HEADING =
  "Under penalties of perjury, I certify that:";

export type TaxClassification =
  | "sole_proprietor"
  | "c_corp"
  | "s_corp"
  | "partnership"
  | "trust_estate"
  | "llc"
  | "other";

/** Line 3a, in the order the form prints them. */
export const TAX_CLASSIFICATIONS: readonly {
  value: TaxClassification;
  label: string;
  hint?: string;
}[] = [
  {
    value: "sole_proprietor",
    label: "Individual or sole proprietor",
    hint: "Most one-person trades. Your TIN is usually your Social Security number.",
  },
  { value: "c_corp", label: "C corporation" },
  { value: "s_corp", label: "S corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust_estate", label: "Trust or estate" },
  {
    value: "llc",
    label: "Limited liability company",
    hint: "Tell us how the LLC is taxed. Your accountant or your filing paperwork will say.",
  },
  { value: "other", label: "Other" },
];

/** Line 3a for an LLC: the classification it elected with the IRS. */
export const LLC_TAX_CLASSES: readonly { value: string; label: string }[] = [
  { value: "C", label: "C corporation" },
  { value: "S", label: "S corporation" },
  { value: "P", label: "Partnership" },
];

export type TinType = "ssn" | "ein";

export const TIN_LABEL: Record<TinType, string> = {
  ssn: "Social Security number",
  ein: "Employer identification number",
};

export interface W9FormData {
  legalName: string;
  businessName: string;
  taxClassification: TaxClassification | "";
  /** Required when taxClassification is "llc". */
  llcTaxClass: string;
  /** Required when taxClassification is "other". */
  otherDescription: string;
  exemptPayeeCode: string;
  fatcaCode: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  tinType: TinType | "";
  /** As typed. Punctuation is stripped before anything is done with it. */
  tin: string;
  /** Typed signature. */
  signedName: string;
  /** The signer ticked the certification box. */
  certified: boolean;
}

export const EMPTY_W9: W9FormData = {
  legalName: "",
  businessName: "",
  taxClassification: "",
  llcTaxClass: "",
  otherDescription: "",
  exemptPayeeCode: "",
  fatcaCode: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  tinType: "",
  tin: "",
  signedName: "",
  certified: false,
};

/** Digits only. A TIN is typed with dashes and pasted with spaces. */
export function normalizeTin(raw: string): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

/** "123456789" -> "123-45-6789" (SSN) or "12-3456789" (EIN). */
export function formatTin(raw: string, type: TinType): string {
  const d = normalizeTin(raw);
  if (d.length !== 9) return d;
  return type === "ssn"
    ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
    : `${d.slice(0, 2)}-${d.slice(2)}`;
}

/** The only part of a TIN any screen is allowed to show. */
export function tinLast4(raw: string): string {
  return normalizeTin(raw).slice(-4);
}

/** How a TIN appears on screen and in the rendered document. */
export function maskedTin(last4: string, type: TinType): string {
  return type === "ssn" ? `XXX-XX-${last4}` : `XX-XXX${last4}`;
}

/**
 * Whether a TIN could be real.
 *
 * Not an IRS lookup, which we cannot do: this only rejects numbers that are
 * definitely not TINs, so a typo is caught while the sub is still on the page
 * rather than at filing time in January. ITINs (which begin with 9) are valid
 * on a W-9 and deliberately pass.
 */
export function tinLooksValid(raw: string, type: TinType): boolean {
  const d = normalizeTin(raw);
  if (d.length !== 9) return false;
  if (/^(\d)\1{8}$/.test(d)) return false; // 000000000, 111111111, ...
  if (d === "123456789") return false;
  if (type === "ssn") {
    const area = d.slice(0, 3);
    if (area === "000" || area === "666") return false;
    if (d.slice(3, 5) === "00") return false;
    if (d.slice(5) === "0000") return false;
  }
  return true;
}

const US_STATE = /^[A-Za-z]{2}$/;
const US_ZIP = /^\d{5}(-?\d{4})?$/;

/**
 * Field-level errors, keyed by field name so the form can put each message
 * next to the input that caused it. Empty object means the form is signable.
 */
export function validateW9(form: W9FormData): Record<string, string> {
  const e: Record<string, string> = {};
  const t = (v: string) => String(v ?? "").trim();

  if (t(form.legalName).length < 2) {
    e.legalName = "Enter the name shown on your income tax return.";
  }
  if (!form.taxClassification) {
    e.taxClassification = "Choose how your business is taxed.";
  }
  if (form.taxClassification === "llc" && !LLC_TAX_CLASSES.some((c) => c.value === form.llcTaxClass)) {
    e.llcTaxClass = "Tell us whether the LLC is taxed as a C corp, S corp, or partnership.";
  }
  if (form.taxClassification === "other" && t(form.otherDescription).length < 2) {
    e.otherDescription = "Describe how the business is classified.";
  }
  if (t(form.address).length < 3) e.address = "Enter the address where mail should go.";
  if (t(form.city).length < 2) e.city = "Enter a city.";
  if (!US_STATE.test(t(form.state))) e.state = "Use the two-letter state code, such as CA.";
  if (!US_ZIP.test(t(form.zip))) e.zip = "Enter a 5 or 9 digit ZIP code.";

  if (!form.tinType) {
    e.tinType = "Choose which number you are giving us.";
  } else if (!tinLooksValid(form.tin, form.tinType)) {
    e.tin =
      normalizeTin(form.tin).length === 9
        ? "That does not look like a valid number. Check it against your paperwork."
        : `Enter all 9 digits of your ${TIN_LABEL[form.tinType]}.`;
  }

  if (t(form.exemptPayeeCode) && !/^[0-9]{1,2}$/.test(t(form.exemptPayeeCode))) {
    e.exemptPayeeCode = "Exempt payee codes are one or two digits. Leave blank if unsure.";
  }
  if (t(form.fatcaCode) && !/^[A-Za-z]{1,2}$/.test(t(form.fatcaCode))) {
    e.fatcaCode = "FATCA codes are one or two letters. Leave blank if unsure.";
  }

  if (t(form.signedName).length < 2) {
    e.signedName = "Type your full name to sign.";
  }
  if (!form.certified) {
    e.certified = "You have to agree to the certification above before signing.";
  }
  return e;
}

export function classificationLabel(form: W9FormData): string {
  const base = TAX_CLASSIFICATIONS.find((c) => c.value === form.taxClassification);
  if (!base) return "Not stated";
  if (form.taxClassification === "llc") {
    const llc = LLC_TAX_CLASSES.find((c) => c.value === form.llcTaxClass);
    return llc ? `${base.label}, taxed as a ${llc.label}` : base.label;
  }
  if (form.taxClassification === "other" && form.otherDescription.trim()) {
    return `${base.label}: ${form.otherDescription.trim()}`;
  }
  return base.label;
}

export interface SignedW9Meta {
  signedName: string;
  signedAt: Date;
  /** The company Brost Co knows this subcontractor as, for the header. */
  companyName: string;
}

/**
 * The document, as text.
 *
 * This exact string is what the signer reviews on screen, what the stored PDF
 * renders, and what gets hashed. One source for all three is the only way the
 * hash proves anything: if the review screen and the PDF were built
 * separately they could drift, and then the hash would attest to a document
 * nobody ever saw.
 *
 * The TIN appears masked. The full number is certified through the hash (see
 * w9DocHash) and stored encrypted; putting it in readable text here would put
 * it in a stored PDF, which is a copy of the most sensitive field we hold
 * sitting somewhere it does not need to be.
 */
export function canonicalW9Text(form: W9FormData, meta: SignedW9Meta): string {
  const tinType = (form.tinType || "ssn") as TinType;
  const lines = [
    "SUBSTITUTE FORM W-9",
    "Request for Taxpayer Identification Number and Certification",
    `Certification wording: ${W9_CERTIFICATION_VERSION}`,
    "",
    `Requester: Brost Co`,
    `Submitted for: ${meta.companyName}`,
    "",
    `1. Name (as shown on your income tax return): ${form.legalName.trim()}`,
    `2. Business name / disregarded entity name: ${form.businessName.trim() || "None"}`,
    `3. Federal tax classification: ${classificationLabel(form)}`,
    `4. Exempt payee code: ${form.exemptPayeeCode.trim() || "None"}`,
    `   FATCA exemption code: ${form.fatcaCode.trim() || "None"}`,
    `5. Address: ${form.address.trim()}`,
    `6. City, state, ZIP: ${form.city.trim()}, ${form.state.trim().toUpperCase()} ${form.zip.trim()}`,
    "",
    `Part I. Taxpayer identification number`,
    `   Type: ${TIN_LABEL[tinType]}`,
    `   Number: ${maskedTin(tinLast4(form.tin), tinType)} (full number held encrypted by the requester)`,
    "",
    "Part II. Certification",
    W9_CERTIFICATION_HEADING,
    ...W9_CERTIFICATION.map((c, i) => `${i + 1}. ${c}`),
    "",
    `Signed by: ${form.signedName.trim()}`,
    `Signed at: ${meta.signedAt.toISOString()}`,
  ];
  return lines.join("\n");
}
