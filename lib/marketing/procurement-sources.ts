/**
 * Who buys public work in Idaho, and which board it is advertised on.
 *
 * Every guide on this site repeats one warning, because it is the mistake that
 * costs small contractors the most work: there is no single Idaho bid board.
 * A vendor registers with one purchasing authority, receives its notices, and
 * reasonably concludes they are now seeing Idaho's public work. They are
 * seeing one authority's public work. State purchasing does not advertise
 * state facility construction, neither advertises city work, none of them
 * advertise highway district work, and a federal notice with an Idaho place of
 * performance appears on none of them.
 *
 * This module is that warning as data rather than prose. The field that earns
 * the register its keep is `excludes`: a list of bid boards is easy to find and
 * mostly useless, because the reader's real question is not "what does this
 * cover" but "what am I still missing after checking it". Nobody publishes the
 * second answer, so it is written down here.
 *
 * Two deliberate constraints on what goes in.
 *
 * Every `href` is an official source belonging to the authority itself, never
 * an aggregator. An aggregator's coverage is a commercial decision that can
 * change without notice, and a register that sends people to one is quietly
 * telling them a vendor's index is the system of record.
 *
 * Nothing is entered that has not been checked by hand. `verifiedOn` carries
 * the date, and scripts/seo/check-source-links.mjs re-checks every URL, because
 * a register of links is trusted exactly as long as the links work and a dead
 * one is worse than an absent entry -- it sends somebody to a 404 while looking
 * authoritative. An entry whose URL cannot be confirmed does not ship.
 *
 * Pure data. No server dependencies, so the page, the JSON route, the CSV
 * route and the link checker all read the same list.
 */

export type ProcurementLevel =
  | "Federal"
  | "State of Idaho"
  | "City"
  | "Highway district"
  | "Assistance";

export interface ProcurementSource {
  /** Stable identifier. Safe to reference from an external citation. */
  id: string;
  /** The authority that buys the work, named as it names itself. */
  authority: string;
  level: ProcurementLevel;
  /** The authority's own official page for opportunities or vendor setup. */
  href: string;
  /** What is actually advertised here. */
  covers: string;
  /**
   * What checking this source does not tell you.
   *
   * The reason the register exists. Each item names work a reader might
   * reasonably assume is included and is not.
   */
  excludes: string[];
  /** What a vendor has to do to receive notices or submit a response. */
  registration: string;
  /** ISO date the URL and its described scope were last checked by hand. */
  verifiedOn: string;
}

/**
 * The register.
 *
 * Ordered the way somebody works outward from their own address: the federal
 * source that covers the whole state, then state authorities, then local, then
 * where to get free help. Not ordered by size, which would put the reader's
 * most likely first stop in the middle.
 */
export const PROCUREMENT_SOURCES: ProcurementSource[] = [
  {
    id: "sam-gov",
    authority: "SAM.gov (U.S. federal government)",
    level: "Federal",
    href: "https://sam.gov/contracting",
    covers:
      "Federal contract opportunities across agencies, including sources-sought and presolicitation notices, current solicitations and award notices. Federal work performed in Idaho is advertised here rather than on any Idaho board.",
    excludes: [
      "State of Idaho, city, county and highway district work, none of which is federal procurement.",
      "Subcontracting opportunities under a federal prime contract, which are arranged by the prime and are not advertised as notices.",
      "Work you are eligible for but whose notice uses a NAICS code or keyword you did not search.",
    ],
    registration:
      "An active SAM.gov entity registration with a Unique Entity ID is required before a federal award can be made. Confirm the current registration steps and renewal cadence on SAM.gov itself.",
    verifiedOn: "2026-09-26",
  },
  {
    id: "idaho-division-of-purchasing",
    authority: "Idaho Division of Purchasing",
    level: "State of Idaho",
    href: "https://purchasing.idaho.gov/open-and-future-solicitations/",
    covers:
      "Open and future solicitations that the Division of Purchasing manages on behalf of state agencies, largely goods and services.",
    excludes: [
      "State facility construction, which the Division of Public Works advertises separately.",
      "Highway and transportation construction, advertised by the Idaho Transportation Department.",
      "Any city, county or highway district solicitation.",
      "Solicitations that individual agencies run under their own delegated authority rather than through this division.",
    ],
    registration:
      "Register as a vendor and select the commodity categories you want notices for. Confirm the current process on the division's own pages, and make sure the notified address is a monitored mailbox rather than one person's inbox.",
    verifiedOn: "2026-09-26",
  },
  {
    id: "idaho-division-of-public-works",
    authority: "Idaho Division of Public Works",
    level: "State of Idaho",
    href: "https://dpw.idaho.gov/construction/",
    covers:
      "Construction advertisements and bid results for state-owned facility projects: new buildings, renovations and related trade work.",
    excludes: [
      "Goods and non-construction services, handled by the Division of Purchasing.",
      "Road, bridge and highway construction, handled by the Idaho Transportation Department and by local highway districts.",
      "City-owned facility projects, which the city advertises itself.",
    ],
    registration:
      "Projects are advertised publicly. Licensing, bonding, insurance and prequalification requirements are stated per project in the advertisement and bid documents, so read them per project rather than assuming last project's terms carry over.",
    verifiedOn: "2026-09-26",
  },
  {
    id: "idaho-transportation-department",
    authority: "Idaho Transportation Department",
    level: "State of Idaho",
    href: "https://itd.idaho.gov/contractor-bidding/",
    covers:
      "Advertised state transportation construction projects and the contractor bidding process for them.",
    excludes: [
      "Locally owned roads. A street inside a city or a road under a highway district is that authority's procurement, not the department's.",
      "State facility construction, handled by the Division of Public Works.",
      "Non-construction goods and services.",
    ],
    registration:
      "Transportation construction bidding typically carries its own prequalification, bonding and plan-holder requirements. Confirm the current requirements on the department's contractor bidding pages before planning a bid.",
    verifiedOn: "2026-09-26",
  },
  {
    id: "city-of-boise",
    authority: "City of Boise",
    level: "City",
    href: "https://www.cityofboise.org/departments/finance/purchasing/vendor-information-and-registration/",
    covers:
      "City of Boise purchasing: vendor registration and the city's own solicitations, issued through the procurement system named on that page.",
    excludes: [
      "Every other Treasure Valley jurisdiction. Neighbouring cities each run their own procurement, and registering with Boise subscribes you to Boise only.",
      "Ada County Highway District work, which covers roads inside Boise but is a separate authority with a separate bid source.",
      "State and federal work performed in Boise.",
    ],
    registration:
      "Register as a vendor and select the categories you want to be notified about. Registering with one buyer never subscribes you to another, which is the single most common cause of a missed local bid.",
    verifiedOn: "2026-09-26",
  },
  {
    id: "ada-county-highway-district",
    authority: "Ada County Highway District",
    level: "Highway district",
    href: "https://www.achdidaho.org/projects/bids-procurement",
    covers:
      "Bids and procurement for the district, which owns and maintains the public roads, bridges and related right-of-way across Ada County, including the streets inside Boise.",
    excludes: [
      "City of Boise work that is not roadway, even though it is in the same geography.",
      "State highways, which remain with the Idaho Transportation Department.",
      "Highway districts in other Idaho counties, each of which procures separately.",
    ],
    registration:
      "Opportunities are posted on the district's bids and procurement page. Requirements are stated per project. A contractor working inside Boise city limits often has to watch both this source and the city's.",
    verifiedOn: "2026-09-26",
  },
  {
    id: "idaho-apex-accelerator",
    authority: "Idaho APEX Accelerator",
    level: "Assistance",
    href: "https://www.idahoapexaccelerator.com/",
    covers:
      "No-cost government contracting assistance for Idaho businesses: counselling on registration, eligibility, bid preparation and finding the right buying authority.",
    excludes: [
      "It is not a bid board. It advertises no solicitations of its own, and its separately offered bid-match subscription is not a substitute for checking each authority's official source.",
      "It cannot answer a question about a live solicitation on the buyer's behalf. Those go through the solicitation's stated question process, before its stated deadline.",
    ],
    registration:
      "Contact the accelerator directly to begin counselling. This is an independent public resource and is listed here as a resource, not as an endorsement of any software.",
    verifiedOn: "2026-09-26",
  },
];

/** A register entry by id, or undefined. */
export function procurementSource(id: string): ProcurementSource | undefined {
  return PROCUREMENT_SOURCES.find((source) => source.id === id);
}

/** The levels present, in register order, for grouping the page. */
export function procurementLevels(): ProcurementLevel[] {
  const seen: ProcurementLevel[] = [];
  for (const source of PROCUREMENT_SOURCES) {
    if (!seen.includes(source.level)) seen.push(source.level);
  }
  return seen;
}

/**
 * The most recent hand-check across the register.
 *
 * Shown on the page and in the citation, so a reader can judge the register's
 * freshness for themselves instead of trusting that it is current.
 */
export function lastVerifiedOn(): string {
  return PROCUREMENT_SOURCES.map((s) => s.verifiedOn).sort().at(-1) ?? "";
}

/**
 * The register as CSV.
 *
 * Here rather than in the route so the quoting rules live next to the data.
 * `excludes` is a list flattened with a semicolon: a nested delimiter would be
 * more faithful and would break every spreadsheet that opens the file, and the
 * point of offering CSV at all is that somebody can open it.
 */
export function procurementSourcesCsv(): string {
  const header = [
    "id",
    "authority",
    "level",
    "official_source_url",
    "covers",
    "excludes",
    "registration",
    "verified_on",
  ];
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = PROCUREMENT_SOURCES.map((source) =>
    [
      source.id,
      source.authority,
      source.level,
      source.href,
      source.covers,
      source.excludes.join("; "),
      source.registration,
      source.verifiedOn,
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}
