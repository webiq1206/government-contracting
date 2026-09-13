/** Broad sectors cover the NAICS catalog used by Company Profile.
 * These describe discovery categories, not customer endorsements or a claim
 * that every industry-specific compliance process is automated.
 */
export const INDUSTRIES = [
  {
    name: "Construction",
    codes: ["23"],
    examples: "General contracting, electrical, HVAC, plumbing, site work",
    icon: "build",
  },
  {
    name: "Facilities & support",
    codes: ["56"],
    examples:
      "Janitorial, landscaping, security, staffing, environmental services",
    icon: "building",
  },
  {
    name: "IT & communications",
    codes: ["51"],
    examples: "Software publishing, telecommunications, hosting, media",
    icon: "screen",
  },
  {
    name: "Professional & technical",
    codes: ["54"],
    examples:
      "IT consulting, engineering, architecture, research, business consulting",
    icon: "briefcase",
  },
  {
    name: "Manufacturing",
    codes: ["31", "32", "33"],
    examples:
      "Equipment, electronics, machinery, materials, manufactured goods",
    icon: "build",
  },
  {
    name: "Transportation & logistics",
    codes: ["48", "49"],
    examples: "Freight, passenger transport, warehousing, delivery",
    icon: "truck",
  },
  {
    name: "Healthcare & social services",
    codes: ["62"],
    examples: "Medical services, laboratories, care, community support",
    icon: "health",
  },
  {
    name: "Education & training",
    codes: ["61"],
    examples: "Technical training, instruction, educational support",
    icon: "book",
  },
  {
    name: "Food & accommodation",
    codes: ["72"],
    examples: "Catering, food service, lodging, hospitality",
    icon: "building",
  },
  {
    name: "Wholesale & distribution",
    codes: ["42"],
    examples: "Equipment, supplies, materials, merchant distribution",
    icon: "box",
  },
  {
    name: "Retail & supplies",
    codes: ["44", "45"],
    examples: "Office supplies, building products, vehicles, retail goods",
    icon: "box",
  },
  {
    name: "Utilities",
    codes: ["22"],
    examples: "Electric power, natural gas, water, sewage systems",
    icon: "bolt",
  },
  {
    name: "Agriculture & forestry",
    codes: ["11"],
    examples: "Agricultural services, forestry, fishing, land support",
    icon: "leaf",
  },
  {
    name: "Mining & extraction",
    codes: ["21"],
    examples: "Oil and gas, minerals, quarrying, extraction support",
    icon: "build",
  },
  {
    name: "Finance & insurance",
    codes: ["52"],
    examples: "Financial services, insurance, investment support",
    icon: "briefcase",
  },
  {
    name: "Real estate & leasing",
    codes: ["53"],
    examples: "Property services, equipment rental, vehicle leasing",
    icon: "building",
  },
  {
    name: "Management services",
    codes: ["55"],
    examples: "Company management, enterprise administration",
    icon: "briefcase",
  },
  {
    name: "Arts & recreation",
    codes: ["71"],
    examples: "Museums, entertainment, recreation, cultural services",
    icon: "spark",
  },
  {
    name: "Repair & other services",
    codes: ["81"],
    examples:
      "Equipment repair, vehicle maintenance, laundry, member organizations",
    icon: "build",
  },
  {
    name: "Public administration",
    codes: ["92"],
    examples:
      "Public programs, conservation administration, government support",
    icon: "building",
  },
] as const;
