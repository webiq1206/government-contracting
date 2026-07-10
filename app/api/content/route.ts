import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { parseContentBody } from "@/lib/domain/content";
import type { ContentLibraryItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a new content-library snippet. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = parseContentBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { title, category, content, tags } = parsed.value;

  const row = await queryOne<ContentLibraryItem>(
    `insert into content_library (title, category, body, tags)
     values ($1,$2,$3,$4)
     returning *`,
    [title, category, content, tags]
  );

  await logAgent({
    agent: "operator",
    action: "content-create",
    level: "info",
    message: `${auth.email} added content-library item "${title}" (${category}).`,
  });

  return NextResponse.json({ ok: true, item: row });
}
