/**
 * Demo dataset for the landing product film.
 *
 * This is capture-only fixture data. It never touches the database, so it
 * cannot leak into production counts or mix with real operator records.
 * Values are chosen to look plausible to a government contractor: real agency
 * names, real NAICS codes, realistic solicitation number shapes, and dollar
 * amounts in the right order of magnitude for each trade.
 */

export const COMPANY = {
  name: "Brost Co",
  setAside: "SDVOSB",
  region: "Boise, ID",
};

/** The opportunity the film follows end to end. */
export const HERO = {
  solicitation: "36C10B26Q0124",
  title: "HVAC maintenance, Boise VA",
  agency: "Department of Veterans Affairs",
  naics: "238220",
  setAside: "SDVOSB",
  value: "$1.24M",
  score: 84,
  dueLabel: "Due Aug 24",
  daysLeft: 12,
};

/** Beat 1 — postings arriving from SAM.gov overnight. */
export const INTAKE = [
  { id: "1", title: "HVAC maintenance, Boise VA", agency: "Veterans Affairs", value: "$1.24M" },
  { id: "2", title: "Grounds maintenance IDIQ", agency: "Army Corps", value: "$640K" },
  { id: "3", title: "Pocatello janitorial services", agency: "GSA", value: "$180K" },
  { id: "4", title: "Idaho Falls electrical upgrade", agency: "Dept. of Energy", value: "$95K" },
  { id: "5", title: "Mountain Home HVAC retrofit", agency: "Air Force", value: "$410K" },
];

/** Beat 2 — how the fit score is built. */
export const SCORE_FACTORS = [
  { label: "NAICS match", detail: "238220 exact", weight: 26, of: 30 },
  { label: "Set-aside fit", detail: "SDVOSB eligible", weight: 24, of: 25 },
  { label: "Past performance", detail: "4 similar contracts", weight: 19, of: 25 },
  { label: "Distance", detail: "14 miles", weight: 15, of: 20 },
];

/** Beat 4 — the attention split. */
export const ATTENTION = {
  ranAutomatically: [
    "Solicitation parsed",
    "18 compliance items extracted",
    "11 local trades identified",
    "9 outreach emails sent",
    "3 quotes captured",
  ],
  needsYou: [
    { title: "Call Valley Electric", detail: "No reply after 2 emails" },
    { title: "Approve past performance narrative", detail: "Drafted, needs your read" },
  ],
};

/** Beat 5 — subcontractor sourcing. */
export const SUBS = [
  { name: "Boise Climate Co", trade: "HVAC", miles: 6, rating: "A", stage: "quoted" },
  { name: "Treasure Valley Controls", trade: "Controls", miles: 11, rating: "A", stage: "quoted" },
  { name: "Valley Electric", trade: "Electrical", miles: 9, rating: "B+", stage: "calling" },
  { name: "Idaho TAB Services", trade: "Test & balance", miles: 22, rating: "A-", stage: "quoted" },
  { name: "Cascade Mechanical", trade: "HVAC", miles: 31, rating: "B", stage: "contacted" },
  { name: "Gem State Sheet Metal", trade: "Sheet metal", miles: 17, rating: "B+", stage: "contacted" },
];

/** Beat 6 — the outreach thread that escalates to a call. */
export const OUTREACH = [
  { when: "Aug 8, 6:02 AM", what: "Quote request sent", who: "Valley Electric", auto: true },
  { when: "Aug 9, 9:14 AM", what: "Opened, no reply", who: "Tracked automatically", auto: true },
  { when: "Aug 10, 6:02 AM", what: "Follow-up sent", who: "Valley Electric", auto: true },
  { when: "Aug 12, 7:30 AM", what: "Queued for a call", who: "Needs you", auto: false },
];

/** Beat 7 — quotes landing, in the order they arrive. */
export const QUOTES = [
  { company: "Boise Climate Co", trade: "HVAC", amount: "$186,400", at: 0.18 },
  { company: "Treasure Valley Controls", trade: "Controls", amount: "$41,200", at: 0.38 },
  { company: "Idaho TAB Services", trade: "Test & balance", amount: "$12,800", at: 0.58 },
  { company: "Valley Electric", trade: "Electrical", amount: "$63,900", at: 0.82 },
];

/** Beat 8 — trade coverage completing. */
export const COVERAGE = [
  { trade: "HVAC", done: true },
  { trade: "Controls", done: true },
  { trade: "Test & balance", done: true },
  { trade: "Electrical", done: false },
];

/** Beat 9 — bid package assembly. */
export const PACKAGE_ITEMS = [
  { label: "Pricing rollup", detail: "4 trades · $304,300", auto: true },
  { label: "Certifications", detail: "SDVOSB, SAM registration", auto: true },
  { label: "Compliance matrix", detail: "18 of 18 items", auto: true },
  { label: "Past performance", detail: "3 references attached", auto: true },
  { label: "Signature pages", detail: "Needs your signature", auto: false },
];

/** Beat 11 — the Today list the operator actually opens. */
export const TODAY = [
  {
    kicker: "Decision needed",
    title: "Roof replacement, Boise depot",
    meta: "Score 79 · $820K · 16 days",
    cta: "Pursue or pass",
  },
  {
    kicker: "Final review",
    title: "HVAC maintenance, Boise VA",
    meta: "Package complete · due in 12 days",
    cta: "Review",
  },
];

export const TODAY_AUTOMATED = 14;
