import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { complete, ClaudeNotConfiguredError, claudeEnabled } from "@/lib/ai/claude";
import { config } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import {
  buildAskUserPrompt,
  finalizeAskAnswer,
  GUIDE_ASK_SYSTEM,
} from "@/lib/domain/guide-ask";
import type { PageGuide } from "@/lib/domain/page-guide";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conversational Q&A grounded in the current PageGuide facts + glossary.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  await hydrateIntegrationEnv().catch(() => undefined);

  const body = (await req.json().catch(() => null)) as {
    guide?: PageGuide;
    question?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  } | null;

  const guide = body?.guide;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!guide?.pathname || !question) {
    return NextResponse.json({ error: "guide and question are required." }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  if (!(await claudeEnabled())) {
    return NextResponse.json(
      {
        error: "Claude is not connected. Open Integrations to enable Q&A.",
        code: "claude_missing",
      },
      { status: 503 }
    );
  }

  try {
    const { text } = await complete(
      buildAskUserPrompt({
        guide,
        question,
        history: Array.isArray(body?.history) ? body.history : [],
      }),
      {
        system: GUIDE_ASK_SYSTEM,
        model: config.claude.model,
        maxTokens: 400,
        temperature: 0.2,
        injectProfile: false,
      }
    );
    const answer = finalizeAskAnswer(text);
    void trackEvent({
      event: "guide_ask",
      orgId: auth.organizationId,
      userId: auth.id,
      path: guide.pathname,
      meta: { pageKey: guide.pageKey, qLen: question.length },
    });
    return NextResponse.json({ answer });
  } catch (e) {
    if (e instanceof ClaudeNotConfiguredError) {
      return NextResponse.json(
        {
          error: "Claude is not connected. Open Integrations to enable Q&A.",
          code: "claude_missing",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ask failed." },
      { status: 500 }
    );
  }
}
