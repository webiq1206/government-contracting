import { NextResponse } from "next/server";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { requireOrgContext } from "@/lib/org-guard";
import { FeedbackForm } from "@/components/feedback-form";
import { feedbackFor } from "@/lib/feedback";
import { categoryLabel } from "@/lib/domain/feedback";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Somewhere to say the product is wrong.
 *
 * There was no route for it. Somebody who found a number that did not add up,
 * or wanted a report this does not have, had one option: the support address
 * on the billing page. That is a billing channel, and the difference showed
 * in what never arrived.
 *
 * Open to every role, including the read-only ones. A viewer looking at a
 * figure that does not match what they can see elsewhere is exactly the
 * person who should be able to say so.
 */
export default async function FeedbackPage() {
  const ctx = await requireOrgContext({ requireBilling: false });
  if (ctx instanceof NextResponse) {
    // The guard answers with JSON for API callers. On a page, the honest
    // rendering is to say so rather than to show an empty form that will be
    // refused when it is submitted.
    return (
      <>
        <PageFrame
          title="Feedback and feature requests"
          explanation="Tell us what is wrong with this product."
        />
        <div className="p-5">
          <p className="text-sm text-muted-foreground">
            This account cannot be read right now, so a report could not be filed
            against it. Sign in again and this page works.
          </p>
        </div>
      </>
    );
  }

  const previous = await feedbackFor(ctx.orgId, 10).catch(() => []);

  return (
    <>
      <PageFrame
        title="Feedback and feature requests"
        explanation="What is broken, what reads wrong, and what this should do that it does not."
        status={
          previous.length > 0
            ? `${previous.length} sent from this account`
            : undefined
        }
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        <div className="max-w-2xl">
          <p className="text-sm leading-relaxed text-muted-foreground">
            The most useful report this product can receive is a number that looks
            wrong. Everything here is assembled from records, and a figure that does
            not match what you can see on another screen is the kind of fault that
            hides for months because it never announces itself.
          </p>
        </div>

        <FeedbackForm />

        {previous.length > 0 && (
          <div className="card max-w-xl space-y-3">
            <p className="eyebrow">Already sent from this account</p>
            <ul className="divide-y divide-border">
              {previous.map((r) => (
                <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-foreground">
                      {categoryLabel(r.category)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {shortDate(r.created_at)}
                      {r.user_email ? ` · ${r.user_email}` : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-3 text-sm leading-relaxed text-slate-700">
                    {r.message}
                  </p>
                  {r.page && (
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.page}</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Only this account&rsquo;s reports, and only the ten most recent. Nothing
              here is visible to another organization.
            </p>
          </div>
        )}

        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Looking for how something works rather than reporting a fault? The{" "}
          <Link href="/how-it-works" className="text-accent hover:underline">
            Knowledge Center
          </Link>{" "}
          has the workflow map, the glossary and the step-by-step articles.
        </p>
      </div>
    </>
  );
}
