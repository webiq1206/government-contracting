"use client";

import type { ReactNode } from "react";
import type { CallCardRow } from "@/lib/data";
import { SkipCallControl } from "@/components/skip-call-control";
import { CallWorkspaceLauncher } from "@/components/call-workspace-launcher";
import { ContactQuickEdit } from "@/components/contact-quick-edit";
import { SubWorkNeeded } from "@/components/sub-work-needed";
import { resolveSubWork } from "@/lib/domain/sub-work";
import { countdown, currency, shortDate } from "@/lib/format";

/**
 * A Call Queue card. The whole card is a single clickable target that opens the
 * Call Workspace slide-over; the "Start call" button opens the same workspace.
 * Everything the operator can decide from without a call, trade, deadline,
 * project value, prior interaction, is visible at a glance on the card itself.
 *
 * Client component on purpose: the phone/email links stop propagation so a tap
 * on them dials/emails instead of opening the workspace, and event handlers
 * can't cross a server->client boundary.
 */
export function CallCard({
  c,
  autoOpen = false,
  selectControl = null,
}: {
  c: CallCardRow;
  autoOpen?: boolean;
  /** Optional checkbox (or other control) that must not open the workspace. */
  selectControl?: ReactNode;
}) {
  const expiry = countdown(c.deadline);
  const overdue = expiry === "overdue";
  const soon =
    !!c.deadline &&
    (new Date(c.deadline).getTime() - Date.now()) / 86_400_000 < 7 &&
    !overdue;
  const subWork = resolveSubWork({
    trade: c.trade,
    analysis: c.solicitation_analysis,
    description: c.description,

  });

  return (
    <CallWorkspaceLauncher
      cardId={c.id}
      autoOpen={autoOpen}
      className="card group cursor-pointer border-border transition-all hover:border-accent/60 hover:shadow-md"
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          {selectControl && (
            <div className="pt-1" onClick={(e) => e.stopPropagation()}>
              {selectControl}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="eyebrow">{c.trade ?? "General"}</p>
              {c.source === "reply" ? (
                <span className="badge bg-pursue/15 text-pursue">Replied, interested</span>
              ) : (
                <span
                  className="badge bg-review/15 text-review"
                  title="We emailed this sub but they haven't replied. Call to follow up; not everyone responds to email."
                >
                  Emailed, no reply yet
                </span>
              )}
            </div>
            <p className="font-display text-xl font-semibold text-foreground truncate">
              {c.company_name}
            </p>
            {c.owner_name && (
              <p className="mt-0.5 text-sm text-slate-500 truncate">
                {c.owner_name}
              </p>
            )}
          </div>
          <span
            className={`badge shrink-0 ${
              overdue
                ? "bg-risk/15 text-risk"
                : soon
                  ? "bg-review/15 text-review"
                  : "bg-surface text-slate-500"
            }`}
          >
            {c.deadline ? `⏱ ${expiry}` : "No deadline"}
          </span>
        </div>

        {/* Project + value line */}
        <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <p className="truncate font-medium text-slate-800">
            {c.opportunity_title ?? "Untitled opportunity"}
          </p>
          <p className="mt-0.5 flex items-center justify-between text-xs text-slate-500">
            <span>{c.agency ?? "-"}</span>
            <span className="num font-medium text-slate-700">
              {c.value_estimated != null ? currency(c.value_estimated) : ""}
            </span>
          </p>
        </div>

        {subWork.work && <SubWorkNeeded work={subWork} variant="compact" />}

        {/* Signals */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {c.phone ? (
            <a
              href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
              onClick={(e) => e.stopPropagation()}
              className="text-accent hover:underline"
            >
              {c.phone}
            </a>
          ) : (
            <span className="text-risk">⚠ No phone on file</span>
          )}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              onClick={(e) => e.stopPropagation()}
              className="text-accent hover:underline"
            >
              ✉ {c.email}
            </a>
          )}
          <ContactQuickEdit
            subId={c.subcontractor_id}
            companyName={c.company_name}
            email={c.email}
            phone={c.phone}
            website={c.website}
            ownerName={c.owner_name}
          />
          {c.needs_project_history && (
            <span
              className="badge bg-review/15 text-review"
              title="We have no past projects on file for this sub. Ask about their last 3 similar jobs during the call."
            >
              Ask about past projects
            </span>
          )}
          {c.deadline && (
            <span className="ml-auto num text-xs text-slate-500">
              Bid due {shortDate(c.deadline)}
            </span>
          )}
        </div>

        {/* Primary action */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <p className="text-xs text-slate-500">
            Opens a full call workspace with script, attachments, and capture form.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {/*
              One click became two questions, and both were being guessed.
              The old control recorded a sentence nobody chose and a scope
              nobody was asked about, so the decision lasted until the next
              Call Prep run rebuilt the card.
            */}
            <SkipCallControl
              callCardId={c.id}
              companyName={c.company_name}
              trade={c.trade ?? null}
            />
            <span className="btn-primary text-xs">Start call</span>
          </div>
        </div>
      </div>
    </CallWorkspaceLauncher>
  );
}
