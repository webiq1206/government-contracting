/**
 * Deterministic eligibility gate, checks whether the company can actually win
 * this award before effort is wasted assembling a package. Produces stable
 * `elig_*` findings (blocker/warning) that flow into the compliance audit and
 * gate submission. Pure and unit-tested.
 */
import type { AuditFinding, CompanyProfileJson, Opportunity, SolicitationAnalysis } from "../types";

/** Normalize a certification token for comparison. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Set-aside keyword -> the certification the company must hold. */
const SETASIDE_CERT: { kw: RegExp; cert: string; label: string }[] = [
  { kw: /\b8\(?a\)?\b/, cert: "8a", label: "8(a)" },
  { kw: /service-?disabled|sdvosb/, cert: "sdvosb", label: "SDVOSB" },
  { kw: /\bvosb\b|veteran-?owned/, cert: "vosb", label: "VOSB" },
  { kw: /edwosb|economically disadvantaged women/, cert: "edwosb", label: "EDWOSB" },
  { kw: /wosb|women-?owned/, cert: "wosb", label: "WOSB" },
  { kw: /hubzone/, cert: "hubzone", label: "HUBZone" },
];

/**
 * Which socioeconomic set-aside a piece of text names, if any.
 *
 * Exported so the decision brief's conflict check classifies a set-aside the
 * same way the eligibility gate does. Two classifications of the same phrase
 * would eventually disagree, and the disagreement would be about whether a
 * company is allowed to bid.
 *
 * Null means the text names none, which is different from naming
 * "unrestricted": one is silence and the other is a statement.
 */
export function setAsideCategory(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/unrestricted|full and open/.test(t)) return "unrestricted";
  const isSdvosb = /service-?disabled|sdvosb/.test(t);
  const isEdwosb = /edwosb|economically disadvantaged women/.test(t);
  for (const s of SETASIDE_CERT) {
    if (s.cert === "vosb" && isSdvosb) continue;
    if (s.cert === "wosb" && isEdwosb) continue;
    if (s.kw.test(t)) return s.cert;
  }
  // "Total Small Business" and friends: a real set-aside, no certification.
  if (/small business/.test(t)) return "small_business";
  return null;
}

export function checkEligibility(input: {
  profile: CompanyProfileJson;
  opp: Pick<Opportunity, "naics_code" | "value_estimated" | "set_aside_type">;
  analysis: SolicitationAnalysis | null;
}): AuditFinding[] {
  const { profile, opp, analysis } = input;
  const findings: AuditFinding[] = [];
  const held = new Set((profile.certifications ?? []).map(norm));
  const setAsideText = `${opp.set_aside_type ?? ""} ${analysis?.set_aside ?? ""}`.toLowerCase();

  // 1. Named socioeconomic set-aside requires a certification we must hold.
  const isSdvosb = /service-?disabled|sdvosb/.test(setAsideText);
  const isEdwosb = /edwosb|economically disadvantaged women/.test(setAsideText);
  for (const s of SETASIDE_CERT) {
    // SDVOSB text also reads as "veteran-owned"; EDWOSB text also reads as
    // "women-owned". Don't double-flag the broader category.
    if (s.cert === "vosb" && isSdvosb) continue;
    if (s.cert === "wosb" && isEdwosb) continue;
    if (s.kw.test(setAsideText) && !held.has(s.cert)) {
      findings.push({
        id: `elig_setaside_${s.cert}`,
        severity: "blocker",
        category: "other",
        finding: `This opportunity is set aside for ${s.label}, but your company profile does not list a ${s.label} certification.`,
        recommendation: `Only bid if you actually hold ${s.label}. If you do, add it to your Company Profile; if not, this award is not open to you.`,
      });
    }
  }

  // 2. Small-business set-aside but the profile isn't a small business.
  if (/small business|total small business|sba set-?aside/.test(setAsideText) && !profile.small_business) {
    findings.push({
      id: "elig_small_business",
      severity: "blocker",
      category: "other",
      finding:
        "This is a small-business set-aside, but your Company Profile is not marked as a small business.",
      recommendation:
        "Confirm your size status for this NAICS. Only small businesses may bid on a small-business set-aside.",
    });
  }

  // 3. NAICS not in the company's registered list.
  const naics = opp.naics_code?.trim();
  const registered = (profile.naics_codes ?? []).map((n) => n.trim());
  if (naics && registered.length > 0 && !registered.includes(naics)) {
    findings.push({
      id: "elig_naics",
      severity: "warning",
      category: "other",
      finding: `The solicitation's NAICS code ${naics} is not in your registered NAICS list.`,
      recommendation:
        "Make sure you're registered under this NAICS in SAM.gov, and that your size status covers it, before bidding.",
    });
  }

  // 4. Bonding required and the project value exceeds bonding capacity.
  const bondingRequired = (analysis?.qualifications?.bonding ?? []).length > 0;
  if (
    bondingRequired &&
    profile.bonding_capacity != null &&
    opp.value_estimated != null &&
    opp.value_estimated > profile.bonding_capacity
  ) {
    findings.push({
      id: "elig_bonding",
      severity: "warning",
      category: "other",
      finding: `This project (est. $${opp.value_estimated.toLocaleString()}) exceeds your bonding capacity ($${profile.bonding_capacity.toLocaleString()}).`,
      recommendation:
        "Confirm your surety can bond this size before bidding, an insufficient bond makes the offer non-responsive.",
    });
  }

  // 5. No SAM identifiers on file (must be registered to be awarded).
  if (!profile.uei && !profile.cage_code) {
    findings.push({
      id: "elig_registration",
      severity: "warning",
      category: "other",
      finding: "Your Company Profile has no UEI or CAGE code.",
      recommendation:
        "You must have an active SAM.gov registration (UEI, and usually CAGE) to be awarded a federal contract. Add them to your profile.",
    });
  }

  return findings;
}
