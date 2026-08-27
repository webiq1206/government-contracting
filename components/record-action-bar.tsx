"use client";

import Link from "next/link";
import { openEditorialTarget } from "@/lib/editorial-nav";
import type { NextStep } from "@/lib/domain/journey";

/**
 * The one action this record is waiting on, reachable from any tab, on a phone.
 *
 * On a wide screen the next step sits at the top of Overview and the other six
 * sections are a glance away. On a phone they are not: reading the documents
 * means leaving the tab that says what to do, and coming back means scrolling
 * a long page to find it again. So the action follows the reader.
 *
 * One action, never a row of them. A bar with four buttons on a 375-pixel
 * screen is four buttons nobody presses, and the point of this is that the
 * next move is unmissable rather than that everything is available.
 *
 * Mobile only. Above the tab bar, clear of the home indicator, and it pads the
 * page behind it so the last line of content is not permanently underneath it.
 */
export function RecordActionBar({ step }: { step: NextStep }) {
  // Nothing to press and nowhere to go is not a bar worth the space it takes.
  if (!step.cta || !(step.href || step.anchor)) return null;

  const tone =
    step.tone === "action"
      ? "bg-pursue text-on-status"
      : step.tone === "warn"
        ? "bg-review text-on-status"
        : "bg-foreground text-background";
  const button = `inline-flex min-h-11 shrink-0 items-center rounded-md px-4 text-sm font-medium ${tone}`;

  return (
    <>
      {/*
        A fixed bar covers whatever is under it, permanently, and the thing
        under it is the last line of the page. This reserves the height in
        normal flow so the end of a document is reachable rather than sitting
        behind the control that is meant to help.
      */}
      <div className="h-[4.25rem] lg:hidden" aria-hidden />
      <div
      /*
       * bottom-16 clears the mobile tab bar, which is fixed at bottom-0 and
       * four rem tall; its own safe-area padding sits below that, so the
       * inset is added here rather than doubled.
       */
      className="fixed inset-x-0 bottom-16 z-50 border-t border-border bg-background/95 px-3 py-2 backdrop-blur lg:hidden"
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Next step</p>
          {/*
            One line, truncated. The full sentence and the reason are on
            Overview; repeating them here would make a bar tall enough to
            cover the content it sits over.
          */}
          <p className="truncate text-sm font-medium text-foreground">{step.title}</p>
        </div>
        {step.href ? (
          <Link href={step.href} className={button}>
            {step.cta}
          </Link>
        ) : (
          /*
           * An in-page target is a tab on this record, not a scroll position.
           * A plain hash would move the viewport to a panel the tab strip has
           * not opened, which on a phone means an apparently empty screen.
           * openEditorialTarget opens the tab first and then scrolls.
           */
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
