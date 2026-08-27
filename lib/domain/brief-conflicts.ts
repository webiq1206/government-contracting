import { setAsideCategory } from "@/lib/domain/eligibility";
import { extractValueFromText } from "@/lib/domain/value-extract";

/**
 * Where the notice and the document do not agree.
 *
 * The decision brief lists what is known and what is missing. It had no place
 * for the third thing, which is two sources stating different facts, and that
 * third thing is the one most likely to lose a bid: the portal record says
 * Total Small Business and the solicitation says SDVOSB, and a company that
 * reads only one of them submits a proposal it can be disqualified on.
 *
 * Two rules govern everything here.
 *
 * Absence is not a conflict. A field the notice states and the document does
 * not is a fact, not a disagreement, and belongs in the missing list. Treating
 * silence as contradiction would fill this section on every thin notice and
 * teach the operator to skip it.
 *
 * And a conflict is reported, never resolved. Nothing here picks a winner: the
 * value backfill in the analyst deliberately only fills a null, so a portal
 * figure and a document figure that disagree both survive in the record, and
 * this is where a person is told to go and look.
 */

export interface FactConflict {
  /** The field in the words the interface uses elsewhere. */
  field: string;
  /** What the portal record says. */
  fromNotice: string;
  /** What the solicitation itself says. */
  fromDocument: string;
  /** One clause on why it changes the decision. */
  matters: string;
}

export interface ConflictInput {
  setAsideFromNotice: string | null | undefined;
  setAsideFromDocument: string | null | undefined;
  valueFromNotice: number | null | undefined;
  /** The analyst's own reading, as the string it wrote. */
  valueTextFromDocument: string | null | undefined;
}

/**
 * How far two money figures may differ before it is a disagreement rather than
 * a rounding.
 *
 * A quarter, because a solicitation quoting "approximately $1.2M" against a
 * portal figure of $1,150,000 is one fact told twice, and $120,000 against
 * $1,200,000 is a misplaced zero somebody has to catch before pricing a bid
 * against the wrong one.
 */
const VALUE_TOLERANCE = 0.25;

export function conflictingFacts(i: ConflictInput): FactConflict[] {
  const out: FactConflict[] = [];

  const noticeSetAside = setAsideCategory(i.setAsideFromNotice);
  const documentSetAside = setAsideCategory(i.setAsideFromDocument);
  if (noticeSetAside && documentSetAside && noticeSetAside !== documentSetAside) {
    out.push({
      field: "Set-aside",
      fromNotice: (i.setAsideFromNotice ?? "").trim(),
      fromDocument: (i.setAsideFromDocument ?? "").trim(),
      matters:
        "These name different eligibility. Bidding against the wrong one is a proposal that can be thrown out unread.",
    });
  }

  const documentValue = extractValueFromText(i.valueTextFromDocument);
  if (i.valueFromNotice != null && documentValue != null) {
    const larger = Math.max(i.valueFromNotice, documentValue);
    const smaller = Math.min(i.valueFromNotice, documentValue);
    if (larger > 0 && (larger - smaller) / larger > VALUE_TOLERANCE) {
      out.push({
        field: "Contract value",
        fromNotice: money(i.valueFromNotice),
        fromDocument: money(documentValue),
        matters:
          "The score, the pricing and whether this is above the self-approval limit all rest on one of these being right.",
      });
    }
  }

  return out;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
