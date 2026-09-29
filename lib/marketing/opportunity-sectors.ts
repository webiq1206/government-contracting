/** The day these pages last changed in a way a visitor would notice. */
export const SECTORS_UPDATED_ON = "2026-09-29";

/**
 * NAICS codes contractors in each sector most often see on federal notices.
 * Codes and titles follow the 2022 NAICS edition. Every notice names its own
 * code, and the small business size standard follows that code, so the list
 * is a place to start a search, not a substitute for reading the notice.
 */
export interface SectorNaics { code: string; title: string }

export const OPPORTUNITY_SECTORS = [
  { slug: "construction", title: "Government construction contracts", description: "Find official construction bid sources and check site visits, drawings, amendments and trade coverage before committing to a response.", terms: ["construction", "renovation", "roof replacement", "facility repair"], naics: [
      { code: "236220", title: "Commercial and Institutional Building Construction" },
      { code: "237310", title: "Highway, Street, and Bridge Construction" },
      { code: "238160", title: "Roofing Contractors" },
      { code: "238210", title: "Electrical Contractors and Other Wiring Installation Contractors" },
      { code: "238220", title: "Plumbing, Heating, and Air-Conditioning Contractors" },
      { code: "238910", title: "Site Preparation Contractors" },
    ] satisfies SectorNaics[], checks: ["Check the actual place of performance and site access requirements.", "Locate drawings, specifications, amendments and questions already answered by the buyer.", "Confirm required site visits, qualifications and bonding with the solicitation.", "Assign each trade and resolve overlapping exclusions before relying on a quote."], guide: "idaho-government-construction-bids", tool: "compliance-matrix" },
  { slug: "cleaning", title: "Government cleaning and janitorial contracts", description: "Find official custodial and janitorial opportunities, then evaluate service hours, staffing, floor care, supplies and site requirements.", terms: ["janitorial", "custodial", "cleaning services", "floor care"], naics: [
      { code: "561720", title: "Janitorial Services" },
      { code: "561210", title: "Facilities Support Services" },
      { code: "561790", title: "Other Services to Buildings and Dwellings" },
      { code: "561740", title: "Carpet and Upholstery Cleaning Services" },
    ] satisfies SectorNaics[], checks: ["Separate recurring service from one-time, deep-clean or specialty work.", "Check the service schedule, accessible areas, inspection requirements and site visit instructions.", "Verify which supplies, equipment and consumables the contractor must provide.", "Build staffing and pricing from the stated scope and applicable requirements, not square footage alone."], guide: "idaho-janitorial-government-contracts", tool: "bid-no-bid" },
  { slug: "it-services", title: "Government IT services contracts", description: "Find official federal technology opportunities and organize questions about access, deliverables, qualifications, support coverage and submission requirements.", terms: ["IT support", "help desk", "software development", "systems integration"], naics: [
      { code: "541511", title: "Custom Computer Programming Services" },
      { code: "541512", title: "Computer Systems Design Services" },
      { code: "541513", title: "Computer Facilities Management Services" },
      { code: "541519", title: "Other Computer Related Services" },
      { code: "518210", title: "Computing Infrastructure Providers, Data Processing, Web Hosting, and Related Services" },
    ] satisfies SectorNaics[], checks: ["Distinguish a market research request from a solicitation accepting proposals or quotes.", "Identify security, data handling and access requirements in the actual solicitation.", "Check required qualifications, named labor categories, deliverables and service coverage.", "Map every response instruction to an owner and a location in the proposal."], guide: "sam-gov-opportunity-search", tool: "capability-statement" },
] as const;
