/**
 * Recipient clock for an outreach send.
 *
 * Only stored subcontractor state and city are read. A single-zone state is
 * enough. A state that spans zones counts only when the city is an exact
 * entry in the list below. Anything else — a missing city, an unlisted city,
 * an address, a note, a web page, a scrape, or the job site — is not a zone.
 * Callers then use the account's organizations.timezone, and America/Boise
 * when that is unset.
 *
 * Split states are omitted here on purpose. Guessing the majority of a
 * state's population would send to the other half at the wrong hour.
 */
import {
  isRecognizedTimeZone,
  resolveOutreachSendTimeZone,
} from "./outreach-send-window";

const EASTERN = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const PACIFIC = "America/Los_Angeles";
const BOISE = "America/Boise";

/** States that sit in one IANA zone. Split states are absent. */
const SINGLE_ZONE_STATE: Record<string, string> = {
  AL: CENTRAL,
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: CENTRAL,
  CA: PACIFIC,
  CO: MOUNTAIN,
  CT: EASTERN,
  DE: EASTERN,
  DC: EASTERN,
  GA: EASTERN,
  HI: "Pacific/Honolulu",
  IL: CENTRAL,
  IA: CENTRAL,
  LA: CENTRAL,
  ME: EASTERN,
  MD: EASTERN,
  MA: EASTERN,
  MN: CENTRAL,
  MS: CENTRAL,
  MO: CENTRAL,
  MT: MOUNTAIN,
  NV: PACIFIC,
  NH: EASTERN,
  NJ: EASTERN,
  NM: MOUNTAIN,
  NY: EASTERN,
  NC: EASTERN,
  OH: EASTERN,
  OK: CENTRAL,
  PA: EASTERN,
  RI: EASTERN,
  SC: EASTERN,
  UT: MOUNTAIN,
  VT: EASTERN,
  VA: EASTERN,
  WA: PACIFIC,
  WV: EASTERN,
  WI: CENTRAL,
  WY: MOUNTAIN,
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
};

function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/[.’']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function zoneCities(groups: Array<[string, string[]]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [zone, names] of groups) {
    for (const name of names) {
      const key = normalizeCity(name);
      if (!key) continue;
      if (out[key] && out[key] !== zone) {
        throw new Error(`${key} is listed in two recipient time zones.`);
      }
      out[key] = zone;
    }
  }
  return out;
}

/**
 * Exact city → zone for states that span two zones.
 * A city that is not in this list does not get a guessed zone.
 */
const SPLIT_STATE_CITY: Record<string, Record<string, string>> = {
  FL: zoneCities([
    [CENTRAL, [
      "Pensacola", "Pace", "Milton", "Gulf Breeze", "Navarre",
      "Fort Walton Beach", "Ft Walton Beach", "Destin", "Crestview", "Niceville",
      "Mary Esther", "Valparaiso", "Panama City", "Panama City Beach", "Lynn Haven",
      "Chipley", "Bonifay", "DeFuniak Springs", "Marianna", "Freeport",
    ]],
    [EASTERN, [
      "Miami", "Miami Beach", "Hialeah", "Orlando", "Tampa", "St. Petersburg", "Saint Petersburg",
      "Jacksonville", "Tallahassee", "Fort Lauderdale", "Gainesville", "Sarasota", "Naples",
      "West Palm Beach", "Clearwater", "Lakeland", "Daytona Beach", "Boca Raton",
      "Port St. Lucie", "Fort Myers", "Kissimmee", "Ocala", "Melbourne", "Cape Coral",
      "Hollywood", "Coral Springs", "Pembroke Pines", "Key West", "St. Augustine", "Saint Augustine",
    ]],
  ]),
  TX: zoneCities([
    [MOUNTAIN, [
      "El Paso", "Horizon City", "Socorro", "Anthony", "Canutillo", "Clint", "Fabens",
      "San Elizario", "Fort Bliss",
    ]],
    [CENTRAL, [
      "Houston", "Dallas", "Austin", "San Antonio", "Fort Worth", "Arlington", "Plano",
      "Lubbock", "Amarillo", "Corpus Christi", "Laredo", "Irving", "Garland", "Frisco",
      "McKinney", "Brownsville", "Waco", "Midland", "Odessa", "Beaumont", "Abilene",
      "College Station", "Tyler", "Round Rock", "McAllen", "Killeen", "Denton",
    ]],
  ]),
  KS: zoneCities([
    [MOUNTAIN, ["Goodland", "Sharon Springs", "Tribune", "Syracuse", "Kanorado", "Weskan"]],
    [CENTRAL, [
      "Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka", "Lawrence", "Shawnee",
      "Manhattan", "Lenexa", "Salina", "Hutchinson", "Leavenworth", "Dodge City",
      "Garden City", "Liberal", "Hays",
    ]],
  ]),
  NE: zoneCities([
    [MOUNTAIN, ["Scottsbluff", "Gering", "Alliance", "Chadron", "Sidney", "Kimball", "Terrytown"]],
    [CENTRAL, [
      "Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney", "Fremont", "Hastings",
      "North Platte", "Norfolk", "Columbus", "Papillion",
    ]],
  ]),
  ND: zoneCities([
    [MOUNTAIN, ["Bowman", "Hettinger", "Rhame", "Marmarth", "Beach", "Sentinel Butte", "Amidon"]],
    [CENTRAL, [
      "Fargo", "Bismarck", "Grand Forks", "Minot", "West Fargo", "Williston", "Dickinson",
      "Mandan", "Jamestown",
    ]],
  ]),
  SD: zoneCities([
    [MOUNTAIN, [
      "Rapid City", "Spearfish", "Sturgis", "Belle Fourche", "Lead", "Deadwood", "Custer",
      "Hot Springs", "Hill City", "Box Elder",
    ]],
    [CENTRAL, [
      "Sioux Falls", "Aberdeen", "Brookings", "Watertown", "Mitchell", "Yankton", "Pierre",
      "Huron", "Vermillion",
    ]],
  ]),
  IN: zoneCities([
    [CENTRAL, [
      "Gary", "Hammond", "Merrillville", "East Chicago", "Munster", "Schererville",
      "Crown Point", "Valparaiso", "Portage", "Michigan City", "La Porte", "Evansville",
      "Terre Haute", "Jasper", "Vincennes", "Washington", "Princeton",
    ]],
    [EASTERN, [
      "Indianapolis", "Fort Wayne", "South Bend", "Carmel", "Fishers", "Bloomington",
      "Lafayette", "Muncie", "Anderson", "Columbus", "Kokomo", "Richmond", "Elkhart",
      "Mishawaka", "Jeffersonville", "New Albany", "Noblesville",
    ]],
  ]),
  KY: zoneCities([
    [CENTRAL, [
      "Louisville", "Owensboro", "Bowling Green", "Paducah", "Hopkinsville", "Henderson",
      "Madisonville", "Elizabethtown", "Radcliff",
    ]],
    [EASTERN, [
      "Lexington", "Frankfort", "Covington", "Florence", "Richmond", "Georgetown",
      "Nicholasville", "Ashland", "Pikeville", "London", "Somerset", "Danville", "Winchester",
    ]],
  ]),
  TN: zoneCities([
    [EASTERN, [
      "Knoxville", "Chattanooga", "Johnson City", "Kingsport", "Cleveland", "Morristown",
      "Oak Ridge", "Maryville", "Bristol", "Sevierville",
    ]],
    [CENTRAL, [
      "Nashville", "Memphis", "Clarksville", "Murfreesboro", "Franklin", "Jackson",
      "Hendersonville", "Bartlett", "Germantown", "Collierville", "Smyrna", "Brentwood",
      "Columbia", "Cookeville",
    ]],
  ]),
  MI: zoneCities([
    [CENTRAL, [
      "Ironwood", "Iron Mountain", "Kingsford", "Norway", "Crystal Falls", "Menominee",
      "Escanaba", "Gladstone", "Stephenson",
    ]],
    [EASTERN, [
      "Detroit", "Grand Rapids", "Ann Arbor", "Lansing", "Flint", "Warren", "Dearborn",
      "Troy", "Kalamazoo", "Sterling Heights", "Livonia", "Southfield", "Pontiac",
      "Battle Creek", "Saginaw", "Muskegon", "Holland", "Marquette", "Houghton",
      "Traverse City", "Midland",
    ]],
  ]),
  OR: zoneCities([
    [MOUNTAIN, ["Ontario", "Vale", "Nyssa", "Adrian", "Jordan Valley"]],
    [PACIFIC, [
      "Portland", "Eugene", "Salem", "Bend", "Medford", "Hillsboro", "Beaverton", "Gresham",
      "Springfield", "Corvallis", "Albany", "Grants Pass", "Ashland", "Klamath Falls",
      "Pendleton", "Baker City", "La Grande", "Hood River", "The Dalles", "Redmond", "Lake Oswego",
    ]],
  ]),
  ID: zoneCities([
    [PACIFIC, [
      "Coeur d'Alene", "Coeur d Alene", "Post Falls", "Hayden", "Rathdrum", "Lewiston",
      "Moscow", "Sandpoint", "Kellogg", "Wallace", "Orofino", "Grangeville", "St. Maries",
      "Saint Maries", "Bonners Ferry", "Priest River",
    ]],
    [BOISE, [
      "Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello", "Caldwell", "Twin Falls",
      "Rexburg", "Eagle", "Kuna", "Ammon", "Chubbuck", "Mountain Home", "Blackfoot",
      "Garden City", "Jerome", "Burley", "Hailey",
    ]],
  ]),
};

function stateCode(state: string | null | undefined): string | null {
  const raw = (state ?? "").trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (!raw) return null;
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return STATE_NAME_TO_CODE[raw] ?? null;
}

/**
 * IANA zone for a stored US location, or null when it is not solid.
 * Null is not America/Boise. The caller still has the account zone to try.
 */
export function recipientTimeZoneFromLocation(input: {
  state?: string | null;
  city?: string | null;
} | null | undefined): string | null {
  const code = stateCode(input?.state);
  if (!code) return null;
  const single = SINGLE_ZONE_STATE[code];
  if (single) return single;
  const cities = SPLIT_STATE_CITY[code];
  if (!cities) return null;
  const city = normalizeCity(input?.city ?? "");
  if (!city) return null;
  return cities[city] ?? null;
}

/**
 * Recipient zone, else the account zone, else America/Boise.
 * An unrecognised account name uses America/Boise, not America/Denver.
 */
export function resolveHybridOutreachZone(input: {
  recipientZone?: string | null;
  accountZone?: string | null;
}): string {
  const recipient = (input.recipientZone ?? "").trim();
  if (recipient && isRecognizedTimeZone(recipient)) {
    return resolveOutreachSendTimeZone(recipient);
  }
  return resolveOutreachSendTimeZone(input.accountZone);
}
