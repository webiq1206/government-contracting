import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { complete, ClaudeNotConfiguredError, claudeEnabled } from "@/lib/ai/claude";
import { config } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import {
  buildNarrateUserPrompt,
  finalizeNarration,
  GUIDE_NARRATE_SYSTEM,
} from "@/lib/domain/guide-narrate";
import type { PageGuide } from "@/lib/domain/page-guide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional Claude narration over an already-built PageGuide. Facts stay
 * authoritative; the model only voices them.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  await hydrateIntegrationEnv().catch(() => undefined);

  const body = (await req.json().catch(() => null)) as { guide?: PageGuide } | null;
  const guide = body?.guide;
  if (!guide || typeof guide !== "object" || !guide.pathname) {
    return NextResponse.json({ error: "guide payload required." }, { status: 400 });
  }

  if (!(await claudeEnabled())) {
    return NextResponse.json(
      {
        error: "Claude is not connected. Open Integrations to enable plain-English narration.",
        code: "claude_missing",
      },
      { status: 503 }
    );
  }

  try {
    const { text } = await complete(buildNarrateUserPrompt(guide), {
      system: GUIDE_NARRATE_SYSTEM,
      model: config.claude.model,
      maxTokens: 500,
      temperature: 0.3,
      injectProfile: false,
    });
    return NextResponse.json({ narration: finalizeNarration(text) });
  } catch (e) {
    if (e instanceof ClaudeNotConfiguredError) {
      return NextResponse.json(
        {
          error: "Claude is not connected. Open Integrations to enable plain-English narration.",
          code: "claude_missing",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Narration failed." },
      { status: 500 }
    );
  }
}
