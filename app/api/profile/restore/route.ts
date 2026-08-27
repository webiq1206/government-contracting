import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { profileVersionJson } from "@/lib/profile-history";
import {
  getActiveProfile,
  publishProfile,
  renderProfileText,
} from "@/lib/ai/companyProfile";
import { diffProfiles } from "@/lib/domain/profile-diff";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Put an earlier profile back, as a new version.
 *
 * Forward, never backward. Restoring by reactivating the old row would erase
 * everything saved since and leave a history that reads as though the
 * intervening versions never happened, which is exactly the record an audit
 * asks for. So the old JSON is published as the next version: the mistake is
 * still on file, the correction is on file, and both say who did it.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "manage_profile" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth } = ctx;

  const body = (await req.json().catch(() => ({}))) as { versionId?: string };
  const versionId = typeof body.versionId === "string" ? body.versionId.trim() : "";
  if (!versionId) {
    return NextResponse.json({ error: "Choose a version to restore." }, { status: 400 });
  }

  const json = await profileVersionJson(versionId).catch(() => null);
  // One 404 for "no such version" and "another organization's version": the
  // difference would confirm that an id exists and belongs to somebody else.
  if (!json) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const current = await getActiveProfile().catch(() => null);
  const changes = diffProfiles(current?.profile_json ?? null, json);
  if (changes.length === 0) {
    /*
     * Refused rather than published. A restore that changes nothing would
     * add a version to the history saying nothing happened, which is how a
     * history fills up with noise and stops being read.
     */
    return NextResponse.json(
      { error: "That version matches the current profile. Nothing to restore." },
      { status: 400 }
    );
  }

  const published = await publishProfile(json, renderProfileText(json), auth.id);

  await logAgent({
    agent: "operator",
    action: "profile-restore",
    level: "info",
    message: `${auth.email} restored an earlier company profile, published as version ${published.version}: ${changes
      .slice(0, 4)
      .map((c) => c.summary)
      .join("; ")}`,
  });

  return NextResponse.json({
    ok: true,
    version: published.version,
    changes,
  });
}
