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
