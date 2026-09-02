"use client";

import Link from "next/link";
import { openEditorialTarget } from "@/lib/editorial-nav";
import { ActionButton } from "./action-button";
import { PassButton } from "./pass-button";
import type { NextStep } from "@/lib/domain/journey";

/**
 * The one action this record is waiting on, reachable from any tab, on a phone.
 *
 * On a wide screen the next step sits at the top of Overview and the other six
 * sections are a glance away. On a phone they are not: reading the documents
 * means leaving the tab that says what to do, and coming back means scrolling
 * a long page to find it again. So the action follows the reader.
 *
 * Decision steps (pursue/pass, won/lost) put those buttons on the bar. A bar
 * that only says "See details below" is a signpost to a place the operator
 * already left.
 *
 * Mobile only. Above the tab bar, clear of the home indicator, and it pads the
 * page behind it so the last line of content is not permanently underneath it.
 */
export function RecordActionBar({
  step,
  opportunityId,
}: {
  step: NextStep;
  opportunityId: string;
}) {
  const isTriage = step.decision === "triage";
  const isOutcome = step.decision === "outcome";
  const hasLink = Boolean(step.cta && (step.href || step.anchor));
  if (!isTriage && !isOutcome && !hasLink) return null;

  const tone =
    step.tone === "action"
      ? "bg-pursue text-on-status"
      : step.tone === "warn"
        ? "bg-review text-on-status"
        : "bg-foreground text-background";
  const button = `inline-flex min-h-11 shrink-0 items-center rounded-md px-4 text-sm font-medium ${tone}`;

  return (
    <>
      <div
        className="h-[4.75rem] lg:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-hidden
      />
      <div
        className="fixed inset-x-0 z-50 border-t border-border bg-background/95 px-3 py-2 backdrop-blur lg:hidden"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Next step</p>
            <p className="line-clamp-2 text-sm font-medium text-foreground">{step.title}</p>
          </div>
          {isTriage && (
            <div className="flex shrink-0 items-center gap-2">
              <ActionButton
                endpoint={`/api/opportunities/${opportunityId}/action`}
                body={{ action: "pursue" }}
                className="btn-success text-xs"
              >
                Pursue
              </ActionButton>
              <PassButton opportunityId={opportunityId} className="btn-danger text-xs">
                Pass
              </PassButton>
            </div>
          )}
          {isOutcome && (
            <div className="flex shrink-0 items-center gap-2">
              <ActionButton
                endpoint={`/api/opportunities/${opportunityId}/outcome`}
                body={{ outcome: "won" }}
                className="btn-success text-xs"
                confirm="Mark as WON and create the contract?"
              >
                Won
              </ActionButton>
              <ActionButton
                endpoint={`/api/opportunities/${opportunityId}/outcome`}
                body={{ outcome: "lost" }}
                className="btn-danger text-xs"
                confirm="Mark this bid as lost?"
              >
                Lost
              </ActionButton>
            </div>
          )}
          {!isTriage && !isOutcome && step.href && (
            <Link href={step.href} className={button}>
              {step.cta}
            </Link>
          )}
          {!isTriage && !isOutcome && !step.href && step.anchor && (
            <a
              href={`#${step.anchor}`}
              className={button}
              onClick={(e) => {
                e.preventDefault();
                openEditorialTarget(step.anchor!);
              }}
            >
              {step.cta}
            </a>
          )}
        </div>
      </div>
    </>
  );
}
