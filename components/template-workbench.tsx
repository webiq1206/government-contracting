"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmailTemplateEditor,
  humanSlug,
  slugGuidance,
  type EmailTemplate,
  type TemplateDraftView,
} from "@/components/email-template-editor";
import type { TemplateMetrics } from "@/lib/domain/template-health";

export interface TemplateEntry {
  template: EmailTemplate;
  metrics: TemplateMetrics;
  draft: TemplateDraftView | null;
}

/**
 * A list of the outreach emails, with one of them open.
 *
 * All three used to render fully expanded, one under the other: three token
 * palettes, three bodies, three version histories, roughly nine screens of
 * form. Finding the follow-up meant scrolling past the whole of the initial
 * outreach, and the two follow-ups sat far enough apart to be mistaken for
 * each other, which is the mistake that silently sends nothing.
 *
 * Every editor stays mounted and the unselected ones are hidden, rather than
 * unmounted. Unmounting would throw away whatever the operator had typed and
 * not yet saved the moment they clicked another template in the list, and a
 * confirmation prompt guarding against that is a worse answer than simply not
 * losing the work.
 */
export function TemplateWorkbench({
  entries,
  followupHours,
}: {
  entries: TemplateEntry[];
  followupHours: number;
}) {
  const [openSlug, setOpenSlug] = useState(entries[0]?.template.slug ?? "");
  /*
   * Which templates have an unpublished draft, kept here rather than inside
   * each editor so the list and the count above it move the moment a save
   * lands. Seeded from the server, then owned by whatever the editors report.
   */
  const [drafts, setDrafts] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(entries.map((e) => [e.template.slug, e.draft !== null]))
  );
  const waiting = Object.values(drafts).filter(Boolean).length;
  /*
   * The page header and the tab label are rendered on the server and carry
   * the same count, so they are refreshed rather than left to disagree with
   * the list an operator is looking at.
   */
  const router = useRouter();

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active outreach templates found in the database.
      </p>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:items-start">
      <nav aria-label="Email templates" className="lg:sticky lg:top-4">
        {/*
         * Said once, above the list, as well as on each row. An operator who
         * saved an edit and walked away has one chance to notice before the
         * next outreach run goes out with the old wording.
         */}
        <p
          className={`mb-2 text-xs ${waiting > 0 ? "font-medium text-review" : "text-muted-foreground"}`}
          role="status"
        >
          {waiting === 0
            ? "Every template here is the one being sent."
            : `${waiting} of these ${entries.length} ${waiting === 1 ? "has" : "have"} a saved draft that is not being sent yet.`}
        </p>
        <ul className="space-y-2">
          {entries.map((e) => {
            const open = e.template.slug === openSlug;
            return (
              <li key={e.template.slug}>
                <button
                  type="button"
                  aria-current={open ? "true" : undefined}
                  onClick={() => setOpenSlug(e.template.slug)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    open
                      ? "border-accent/60 bg-accent/5"
                      : "border-border bg-surface hover:border-border/80"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {humanSlug(e.template.slug)}
                  </span>
                  {/* The same sentence the open editor gives, from the same
                      function, so the list cannot drift from the panel. */}
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {slugGuidance(e.template.slug, followupHours)?.when ?? ""}
                  </span>
                  {/*
                   * The state belongs in the list, not only inside the open
                   * editor. A draft on a template nobody has clicked into is
                   * exactly the one that gets forgotten.
                   */}
                  <span className="mt-1.5 block text-xs">
                    {drafts[e.template.slug] ? (
                      <span className="font-medium text-review">
                        Draft saved, not being sent
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {e.template.ownedByOrg === false
                          ? "Using the platform wording"
                          : `Version ${e.template.version} in use`}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>
        {entries.map((e) => (
          <div
            key={e.template.slug}
            hidden={e.template.slug !== openSlug}
          >
            <EmailTemplateEditor
              template={e.template}
              metrics={e.metrics}
              followupHours={followupHours}
              draft={e.draft}
              onDraftChange={(slug, d) => {
                setDrafts((prev) => ({ ...prev, [slug]: d !== null }));
                router.refresh();
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
