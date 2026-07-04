import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/** Email open tracking: marks the communication opened, returns the pixel. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await query(
    `update communications set opened_at = coalesce(opened_at, now()) where tracking_id = $1`,
    [params.id]
  ).catch(() => {});
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Content-Length": String(PIXEL.length),
    },
  });
}
