import { readOptOutToken } from "@/lib/domain/marketing-opt-out";
import { suppressEmail } from "@/lib/domain/email-suppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };

function page(text: string, status = 200, form = "") {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences | BrostCo</title><body><main><h1>Email preferences</h1><p>${text}</p>${form}</main></body></html>`, { status, headers });
}

/** Link scanners may GET this URL. Only an explicit POST changes preferences. */
export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  if (!readOptOutToken(token)) return page("This unsubscribe link is invalid. Reply to the sender to ask them to stop outreach.", 400);
  return page("Stop outreach from the sender of this email. Your account and essential service messages are unchanged.", 200,
    '<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Stop outreach</button></form>');
}

/** RFC 8058 POSTs need no sign-in, cookies, or redirect. */
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  const recipient = readOptOutToken(token);
  if (!recipient) return page("This unsubscribe link is invalid.", 400);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return page("Invalid unsubscribe request.", 400);
  const body = await request.text();
  if (body.length > 1024 || new URLSearchParams(body).get("List-Unsubscribe") !== "One-Click") return page("Invalid unsubscribe request.", 400);
  try {
    await suppressEmail({ ...recipient, source: "unsubscribe", reason: "Recipient used the email unsubscribe link." });
  } catch {
    return page("We could not save your preference. Please retry or reply to the sender.", 503);
  }
  return page("Your preference is saved. Outreach from this sender has been stopped.");
}
