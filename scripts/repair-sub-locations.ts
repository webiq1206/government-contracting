/**
 * One-time repair: give every Google-sourced subcontractor its REAL location.
 *
 * Sub Finder used to stamp the OPPORTUNITY's state and city onto each new
 * subcontractor record, so a firm Google slipped into the results from the
 * wrong side of the country was permanently recorded as local, and roster
 * reuse then offered it for every later job in that state. The finder now
 * stores the firm's own address, but rows written before the fix still carry
 * the job's location.
 *
 * For each sub with a google_place_id, this re-fetches Place Details (one
 * request per row, inside the owning org's context so their own Maps key is
 * used), parses the firm's actual state and city from its formatted address,
 * and corrects the row when they differ. Rows whose address cannot be parsed
 * are left alone and reported. Safe to re-run: a corrected row matches its
 * own address and is skipped as unchanged.
 *
 *   npm run repair:sub-locations
 */
import "../lib/env";
import { query, closePool } from "../lib/db";
import { runWithOrg } from "../lib/tenant-context";
import { googleMaps } from "../lib/integrations/googleMaps";
import { stateCodeFromAddress } from "../lib/us-states";

/** The city segment of a Google formatted address (same rule as Sub Finder). */
function cityFromAddress(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    if (/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[i])) {
      return parts[i - 1] || null;
    }
  }
  return null;
}

async function main() {
  const rows = await query<{
    id: string;
    org_id: string | null;
    company_name: string;
    state: string | null;
    city: string | null;
    google_place_id: string;
  }>(
    `select id, org_id, company_name, state, city, google_place_id
       from subcontractors
      where google_place_id is not null and google_place_id <> ''
      order by created_at asc`
  );
  console.log(`${rows.length} Google-sourced subcontractor(s) to check.`);

  let corrected = 0;
  let unchanged = 0;
  let unparseable = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const details = row.org_id
        ? await runWithOrg(row.org_id, () => googleMaps.placeDetails(row.google_place_id))
        : await googleMaps.placeDetails(row.google_place_id);
      const address = details?.address ?? null;
      if (!address) {
        failed++;
        console.warn(`  ? ${row.company_name}: no address from Place Details, left as is.`);
        continue;
      }
      const realState = stateCodeFromAddress(address);
      const realCity = cityFromAddress(address);
      if (!realState) {
        unparseable++;
        console.warn(`  ? ${row.company_name}: address "${address}" names no state, left as is.`);
        continue;
      }
      const stateNow = (row.state ?? "").trim().toUpperCase();
      const cityNow = (row.city ?? "").trim();
      if (stateNow === realState && (!realCity || cityNow === realCity)) {
        unchanged++;
        continue;
      }
      await query(
        `update subcontractors set state = $2, city = coalesce($3, city), updated_at = now()
          where id = $1`,
        [row.id, realState, realCity]
      );
      corrected++;
      console.log(
        `  * ${row.company_name}: ${stateNow || "(none)"} -> ${realState}${
          realCity && realCity !== cityNow ? ` (${cityNow || "(none)"} -> ${realCity})` : ""
        }`
      );
    } catch (err) {
      failed++;
      console.warn(`  ! ${row.company_name}: ${(err as Error).message}`);
    }
  }

  console.log(
    `Done. Corrected ${corrected}, already right ${unchanged}, no parseable state ${unparseable}, lookup failed ${failed}.`
  );
  if (corrected > 0) {
    console.log(
      "Corrected firms recorded in the wrong state may be paired with open opportunities they cannot serve. Review each open opportunity's sub list, or re-run Sub Finder from its page."
    );
  }
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
