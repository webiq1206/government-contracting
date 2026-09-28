import { INDEXNOW_KEY } from "@/lib/marketing/indexnow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /indexnow-key.txt, the ownership proof for IndexNow submissions.
 *
 * A search engine that receives an IndexNow ping fetches this file and checks
 * that it contains the key that was submitted. If it does not match, the
 * submission is rejected -- so this route and lib/marketing/indexnow.ts must
 * serve the same value, which is why both read the one constant.
 *
 * A route rather than a file in public/, so the key cannot drift out of sync
 * with the submitter, and so rotating it is a single-line change in one place.
 *
 * Served as text/plain with no trailing newline: the specification says the
 * file's content is the key, and some validators compare the body exactly.
 */
export async function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
