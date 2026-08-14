import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { sam } from "@/lib/integrations/sam";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Look the customer's own company up in SAM's entity registry.
 *
 * Read-only. It searches and returns candidates; it writes nothing. The
 * customer picks a match, reviews the fields on screen, and saves through the
 * normal profile endpoint. That separation is deliberate: a UEI or CAGE code
 * silently written from a name search that matched the wrong subsidiary would
 * ride onto every bid the platform produces.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  // The SAM key may be stored in the UI-managed integration settings rather
  // than the environment, so hydrate before checking whether it is usable.
  await hydrateIntegrationEnv();

  const body = (await req.json().catch(() => ({}))) as { uei?: string; name?: string };
  const uei = typeof body.uei === "string" ? body.uei.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!uei && !name) {
    return NextResponse.json(
      { error: "Enter your UEI or your registered company name." },
      { status: 400 }
    );
  }
  // A UEI is 12 alphanumeric characters. Catching this here saves a round trip
  // and tells the customer what is wrong with what they typed.
  if (uei && !/^[A-Za-z0-9]{12}$/.test(uei)) {
    return NextResponse.json(
      { error: "A UEI is 12 letters and numbers. Check it, or search by company name instead." },
      { status: 400 }
    );
  }

  const result = await sam.findEntities(uei ? { uei } : { name });

  if (result.disabled) {
    return NextResponse.json(
      {
        error:
          "SAM.gov is not connected yet. Add your SAM.gov API key on this page first, then import.",
      },
      { status: 409 }
    );
  }
  if (result.error) {
    // Say which failure this is. "SAM did not respond" sent someone away to
    // retry a call that will fail identically every time, when the real
    // answer is that the key is not entitled to entity data.
    const status = result.status;
    const notEntitled = status === 401 || status === 403;
    const message = notEntitled
      ? "Your SAM.gov key works for opportunity searches but is not authorized for entity data, which is a separate entitlement on SAM's side. Ask SAM.gov to enable Entity Management for this key, or fill the fields in by hand below."
      : status === 429
        ? "SAM.gov is rate limiting this key right now. Wait a minute and try again."
        : "SAM.gov did not respond. That is usually temporary; try again in a moment, or fill the fields in by hand.";

    await logAgent({
      agent: "operator",
      action: "sam-profile-import-failed",
      level: "warn",
      status: "error",
      // The detail is SAM's own error text, which names the missing
      // entitlement. Logged rather than shown: it is theirs, not the
      // customer's, and it reads like a stack trace.
      message: `SAM entity lookup failed for ${ctx.user.email}: HTTP ${status ?? "unknown"}${
        result.detail ? `, ${result.detail}` : ""
      }`,
    });

    return NextResponse.json({ error: message, samStatus: status ?? null }, { status: 502 });
  }
  if (result.entities.length === 0) {
    return NextResponse.json({
      entities: [],
      message: uei
        ? "No SAM registration found for that UEI. Check it on sam.gov, or search by company name."
        : "No SAM registration matched that name. Try the exact legal name on your registration, or search by UEI.",
    });
  }

  await logAgent({
    agent: "operator",
    action: "sam-profile-import",
    level: "info",
    message: `${ctx.user.email} searched SAM.gov for their company registration (${
      uei ? "by UEI" : "by name"
    }); ${result.entities.length} match${result.entities.length === 1 ? "" : "es"} returned.`,
  });

  return NextResponse.json({ entities: result.entities });
}
