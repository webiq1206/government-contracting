import { NextResponse } from "next/server";
import { decodePortalToken } from "@/lib/domain/sub-portal-link";
import { loadPortalSubject, recordSignedW9 } from "@/lib/sub-compliance-store";
import { validateW9, EMPTY_W9, type W9FormData } from "@/lib/domain/w9";
import { guardRejectedToken, guardWrite } from "@/lib/vendor-throttle";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A subcontractor signs their own W-9.
 *
 * Unauthenticated on purpose, exactly like /d/[token]: the signer has no
 * account and the token is the authorization. What the token buys is narrow,
 * which is what makes that acceptable. It names one subcontractor, it expires,
 * and this route will only ever write a W-9 for the subcontractor named in it.
 * The id in the token is never taken from the request body.
 *
 * There is no operator equivalent of this route, and there must not be. A W-9
 * is certified under penalty of perjury by the taxpayer; a member of staff
 * signing one for a subcontractor would be making a false certification in the
 * subcontractor's name.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const pointer = decodePortalToken(params.token);
  if (!pointer) {
    // Counted before the reply, so a run of guesses gets progressively less
    // useful rather than costing us a handler invocation each time.
    return (
      guardRejectedToken(req) ??
      NextResponse.json(
        {
          error:
            "This link has expired. Reply to the email you received and we will send a new one.",
        },
        { status: 403 }
      )
    );
  }

  // Before the database read, the PDF render, and the storage write, all of
  // which this route would otherwise do on demand for anyone holding a link.
  const throttled = guardWrite(req, pointer.s, "sign");
  if (throttled) return throttled;

  const sub = await loadPortalSubject(pointer.s);
  if (!sub) {
    return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Partial<W9FormData> | null;
  if (!body) {
    return NextResponse.json({ error: "We could not read that submission." }, { status: 400 });
  }

  // Take only the fields the form defines, so nothing extra in the body can
  // reach the insert.
  const form: W9FormData = {
    ...EMPTY_W9,
    legalName: String(body.legalName ?? ""),
    businessName: String(body.businessName ?? ""),
    taxClassification: (body.taxClassification ?? "") as W9FormData["taxClassification"],
    llcTaxClass: String(body.llcTaxClass ?? ""),
    otherDescription: String(body.otherDescription ?? ""),
    exemptPayeeCode: String(body.exemptPayeeCode ?? ""),
    fatcaCode: String(body.fatcaCode ?? ""),
    address: String(body.address ?? ""),
    city: String(body.city ?? ""),
    state: String(body.state ?? ""),
    zip: String(body.zip ?? ""),
    tinType: (body.tinType ?? "") as W9FormData["tinType"],
    tin: String(body.tin ?? ""),
    signedName: String(body.signedName ?? ""),
    certified: body.certified === true,
  };

  // Re-run the same rules the browser ran. The client copy is there to give
  // fast feedback, not to be trusted.
  const errors = validateW9(form);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: "Some details still need fixing.", fieldErrors: errors },
      { status: 400 }
    );
  }

  // Part of the signature evidence, not analytics. x-forwarded-for is a list
  // when proxies chain; the first entry is the client.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent");

  try {
    const result = await recordSignedW9(sub, form, { ip, userAgent });
    return NextResponse.json({
      ok: true,
      id: result.id,
      message:
        "Your W-9 is signed and on file. Brost Co will check it over, and you do not need to do anything else with it.",
    });
  } catch (err) {
    await logAgent({
      agent: "compliance",
      action: "w9-sign-failed",
      subcontractorId: sub.id,
      level: "error",
      status: "error",
      message: `A W-9 signature from ${sub.company_name} could not be saved: ${(err as Error).message}`,
    });
    // The signer cannot fix this and should not be asked to retype a TIN into
    // a form that just failed. Point them at a human.
    return NextResponse.json(
      {
        error:
          "We could not save that, and it is our end rather than yours. Reply to the email you received and we will sort it out.",
      },
      { status: 500 }
    );
  }
}
