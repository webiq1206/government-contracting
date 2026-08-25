import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { complete, ClaudeNotConfiguredError } from "@/lib/ai/claude";
import { noEmDash } from "@/lib/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clean up the operator's rough notes: fix grammar, organize, make them readable.
 * Returns the tidied text for the operator to review, it does NOT save. The
 * operator edits/accepts and saves through the normal notes endpoint, so nothing
 * the AI produced is stored without a human confirming it. Preserves every fact;
 * never invents.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const body = await req.json().catch(() => ({}));
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!notes) {
    return NextResponse.json({ error: "Nothing to tidy, the notes are empty." }, { status: 400 });
  }
  if (notes.length > 8000) {
    return NextResponse.json({ error: "Notes are too long to tidy in one pass." }, { status: 400 });
  }

  const prompt = [
    "Rewrite the operator's rough notes below so they are clear, well-organized, and easy to read. Rules:",
    "- Preserve every fact, name, number, date, and detail exactly. Do not add, remove, or invent anything.",
    "- Fix grammar, spelling, and punctuation. Group related points; use short bullet points when it helps.",
    "- Keep it concise and professional. Do not use em dashes.",
    "- Return ONLY the cleaned-up notes, with no preamble or commentary.",
    "",
    "ROUGH NOTES:",
    notes,
  ].join("\n");

  try {
    const { text } = await complete(prompt, { maxTokens: 1200, injectProfile: false });
    return NextResponse.json({ ok: true, tidied: noEmDash(text.trim()) });
  } catch (err) {
    if (err instanceof ClaudeNotConfiguredError) {
      return NextResponse.json(
        { error: "AI is not configured, so notes can't be tidied automatically." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not tidy the notes. Try again." }, { status: 500 });
  }
}
