import { procurementSourcesCsv } from "@/lib/marketing/procurement-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The procurement register as CSV.
 *
 * Alongside the JSON because the people most likely to reuse this are not
 * writing code. A procurement counsellor or an economic development office
 * wants to open it, keep the three columns they care about and paste the result
 * into their own resource page, and for them a spreadsheet is the format and
 * JSON is a wall.
 *
 * Served as an attachment with a named file, so it lands as
 * idaho-procurement-sources.csv instead of a browser tab full of quoted text.
 */
export async function GET() {
  return new Response(procurementSourcesCsv(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="idaho-procurement-sources.csv"',
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
