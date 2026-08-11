/**
 * Builds the LLM prompt for optional Guide Me narration. Pure: the API
 * rebuilds PageGuide from live facts, then asks Claude to voice the same
 * structure in plain English. Never invents tasks not present in the guide.
 */

import type { PageGuide } from "@/lib/domain/page-guide";

export const GUIDE_NARRATE_SYSTEM = `You are Brost Co's in-product guide for government contracting operators.
Speak in plain English. Be concise (120-180 words).
Use the structured facts provided. Do not invent tasks, deadlines, scores, or blockers.
Clearly separate what the operator must do from what Brost Co handles automatically.
No em dashes. No markdown headings. Short paragraphs or a tiny numbered list for actions is fine.
If idle, reassure them and say what happens next. End with the single best next action when one exists.`;

export function buildNarrateUserPrompt(guide: PageGuide): string {
  const lines: string[] = [
    `Page: ${guide.pageKey} (${guide.pathname})`,
    `Experience: ${guide.experience}`,
    `Headline: ${guide.headline}`,
    `Situation: ${guide.situation}`,
  ];
  if (guide.stageLabel) lines.push(`Stage: ${guide.stageLabel}`);
  if (guide.scoreLine) lines.push(`Score: ${guide.scoreLine}`);
  if (guide.automationPaused) lines.push("Automation: paused");
  if (guide.completed.length) lines.push(`Already complete: ${guide.completed.join("; ")}`);
  if (guide.needsAttention.length)
    lines.push(`Needs attention: ${guide.needsAttention.join("; ")}`);
  if (guide.brostHandling.length)
    lines.push(`Brost Co handling: ${guide.brostHandling.join("; ")}`);
  if (guide.whatHappensNext) lines.push(`What happens next: ${guide.whatHappensNext}`);
  if (guide.steps.length) {
    lines.push("Ordered actions:");
    guide.steps.forEach((s, i) => {
      lines.push(
        `${i + 1}. [${s.owner}/${s.tone}] ${s.title}. Why: ${s.why}${
          s.cta ? `. CTA: ${s.cta}` : ""
        }`
      );
    });
  } else {
    lines.push("Ordered actions: none (idle)");
  }
  lines.push("Write the operator-facing narration now.");
  return lines.join("\n");
}

/** Strip accidental em dashes if a model slips past the shared sanitizer. */
export function finalizeNarration(text: string): string {
  return text
    .replace(/\u2014/g, ", ")
    .replace(/\u2013/g, "-")
    .trim();
}
