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
import { loadGuideBundle } from "@/lib/guide/load";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conversational Q&A grounded in the current PageGuide facts + glossary.
 *
 * The facts are rebuilt here from the path rather than accepted from the
 * browser. A guide posted by the client is grounded in whatever the client
 * says, and also in whatever was true when the panel last loaded, which on a
 * page left open all morning is not now. The whole promise of this endpoint is
 * that the answer comes from the account's real state, and it was resting on
 * the caller to supply it.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  await hydrateIntegrationEnv().catch(() => undefined);

  const body = (await req.json().catch(() => null)) as {
    path?: string;
    question?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  } | null;

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const rawPath = typeof body?.path === "string" ? body.path.trim() : "";
  // Same-origin app paths only. The path selects which of this account's
  // records are read, so it must not be able to name anything else.
  const pathname = /^\/[A-Za-z0-9/_-]*$/.test(rawPath) ? rawPath : "";
  if (!pathname || !question) {
    return NextResponse.json({ error: "path and question are required." }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  /*
   * Bounded before it reaches the model. slice(-6) limits how many turns are
   * quoted but not how long each one is, so a client could post six megabyte
   * strings and have them billed as input tokens.
   */
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter(
      (h): h is { role: "user" | "assistant"; content: string } =>
        Boolean(h) &&
        (h.role === "user" || h.role === "assistant") &&
        typeof h.content === "string"
    )
    .slice(-6)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 2000) }));

  if (!(await claudeEnabled())) {
    return NextResponse.json(
      {
        error: "Claude is not connected. Open Integrations to enable Q&A.",
        code: "claude_missing",
      },
      { status: 503 }
    );
  }

  const { guide } = await loadGuideBundle(auth, pathname);

  try {
    const { text } = await complete(
      buildAskUserPrompt({ guide, question, history }),
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
