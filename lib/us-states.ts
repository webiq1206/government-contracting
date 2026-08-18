/**
 * US states, DC, and territories for the service-area multi-select. Service
 * areas are free-text context for the AI (not string-matched in logic), so
 * custom entries are also allowed, but this covers the common picks.
 */
export const US_SERVICE_AREAS: string[] = [
  "Nationwide (all US)",
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
  "Puerto Rico",
  "Guam",
  "U.S. Virgin Islands",
  "American Samoa",
  "Northern Mariana Islands",
];

/** Full state/territory name → USPS 2-letter code (what SAM uses for PoP state). */
export const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR", guam: "GU", "u.s. virgin islands": "VI",
  "american samoa": "AS", "northern mariana islands": "MP",
};

const VALID_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

/** True if a service-area entry means "everywhere" (no geographic limit). */
export function isNationwideArea(area: string): boolean {
  return /nationwide|all\s*(50\s*)?states|all\s*us\b|united states|\bnational\b|\bconus\b/i.test(
    area
  );
}

/**
 * Convert a company's free-text service areas into a set of USPS state codes.
 * Accepts full names ("Idaho"), codes ("ID"), and DC/territories. Returns null
 * when the company is nationwide (or lists no usable areas), meaning "no
 * geographic restriction".
 */
export function serviceAreaStateCodes(serviceAreas: string[] | null | undefined): Set<string> | null {
  if (!serviceAreas || serviceAreas.length === 0) return null;
  if (serviceAreas.some(isNationwideArea)) return null;
  const codes = new Set<string>();
  for (const raw of serviceAreas) {
    const s = raw.trim();
    if (!s) continue;
    const upper = s.toUpperCase();
    if (upper.length === 2 && VALID_CODES.has(upper)) {
      codes.add(upper);
      continue;
    }
    const mapped = STATE_NAME_TO_CODE[s.toLowerCase()];
    if (mapped) codes.add(mapped);
  }
  return codes.size > 0 ? codes : null;
}


/**
 * The USPS state/territory code inside a Google-style formatted address, or
 * null when none can be found.
 *
 * Google formats US addresses as "123 Main St, Yigo, GU 96929, United States"
 * (sometimes without the zip, sometimes without the country). The code is
 * matched as its own comma-separated token so "ID" inside a street name can
 * never read as Idaho.
 */
export function stateCodeFromAddress(address: string | null | undefined): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  // ", ST 12345" / ", ST 12345-6789" / ", ST," / ", ST" at the end.
  const m =
    a.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:\s*,|\s*$)/) ??
    a.match(/,\s*([A-Z]{2})\s*(?:,\s*(?:USA|United States).*)?$/);
  const code = m?.[1]?.toUpperCase() ?? null;
  return code && VALID_CODES.has(code) ? code : null;
}

/**
 * The one state a free-text place clearly names, or null.
 *
 * Used for analysis text like "Andersen AFB, Guam" when the structured
 * place-of-performance state is missing. Returns null when the text names no
 * state or names more than one: a multi-state area is not a single target and
 * guessing between them is how work lands in the wrong one.
 */
export function stateCodeFromText(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const found = new Set<string>();
  // Full names first ("New Mexico" before "Mexico"-style confusion is avoided
  // by matching against the fixed name list on word boundaries).
  // Longest names first, consuming each match, so "West Virginia" cannot also
  // read as "Virginia".
  let lower = t.toLowerCase();
  const byLength = Object.entries(STATE_NAME_TO_CODE).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [name, code] of byLength) {
    const re = new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`);
    if (re.test(lower)) {
      found.add(code);
      lower = lower.replace(re, "$1$2");
    }
  }
  // Bare codes as their own tokens ("Yigo, GU" / "Yigo GU 96929").
  for (const m of t.matchAll(/(?:^|[\s,])([A-Z]{2})(?=$|[\s,.\d])/g)) {
    const code = m[1];
    if (VALID_CODES.has(code)) found.add(code);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** Common federal small-business / socioeconomic certifications. */
export const FEDERAL_CERTIFICATIONS: string[] = [
  "Small Business",
  "8(a) Business Development",
  "HUBZone",
  "Woman-Owned Small Business (WOSB)",
  "Economically Disadvantaged WOSB (EDWOSB)",
  "Service-Disabled Veteran-Owned Small Business (SDVOSB)",
  "Veteran-Owned Small Business (VOSB)",
  "Minority-Owned Business (MBE)",
  "Disadvantaged Business Enterprise (DBE)",
];
