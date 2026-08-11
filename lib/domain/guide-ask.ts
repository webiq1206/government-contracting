/**
 * Prompt helpers for Guide Me Q&A. Answers must stay grounded in the
 * structured PageGuide + glossary tips provided; never invent blockers.
 */

import type { PageGuide } from "@/lib/domain/page-guide";
import { GLOSSARY } from "@/lib/domain/glossary";

export const GUIDE_ASK_SYSTEM = `You are Brost Co's in-product guide for government contracting.
Answer the operator's question using ONLY the structured facts and glossary tips provided.
If the facts do not contain the answer, say what you know and what they should open next (Today, the opportunity, Integrations).
Be concise (under 120 words). No em dashes. No markdown headings.
Distinguish what the operator must do from what Brost Co handles automatically.`;

export function buildAskUserPrompt(input: {
  guide: PageGuide;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
}): string {
  const g = input.guide;
  const glossaryKeys = g.terms.map((t) => t.key);
  const tips = glossaryKeys
    .map((k) => (GLOSSARY[k] ? `${k}: ${GLOSSARY[k]}` : null))
    .filter(Boolean);

  const lines: string[] = [
    `Page: ${g.pageKey} (${g.pathname})`,
    `Headline: ${g.headline}`,
    `Situation: ${g.situation}`,
    g.stageLabel ? `Stage: ${g.stageLabel}` : "",
    g.scoreLine ? `Score: ${g.scoreLine}` : "",
    g.automationPaused ? "Automation: paused" : "",
    g.completed.length ? `Complete: ${g.completed.join("; ")}` : "",
    g.needsAttention.length ? `Needs attention: ${g.needsAttention.join("; ")}` : "",
    g.brostHandling.length ? `Brost handling: ${g.brostHandling.join("; ")}` : "",
    g.whatHappensNext ? `Next: ${g.whatHappensNext}` : "",
    "Steps:",
    ...g.steps.map(
      (s, i) => `${i + 1}. [${s.owner}] ${s.title}. Why: ${s.why}${s.cta ? `. CTA: ${s.cta}` : ""}`
    ),
    tips.length ? `Glossary:\n${tips.join("\n")}` : "",
  ].filter(Boolean);

  if (input.history?.length) {
    lines.push("Prior turns:");
    for (const h of input.history.slice(-6)) {
      lines.push(`${h.role}: ${h.content}`);
    }
  }

  lines.push(`Operator question: ${input.question.trim()}`);
  lines.push("Answer now.");
  return lines.join("\n");
}

export function finalizeAskAnswer(text: string): string {
  return text
    .replace(/\u2014/g, ", ")
    .replace(/\u2013/g, "-")
    .trim();
}
