"use client";

import { useState } from "react";
import type { EmailLogRow } from "@/lib/data";

/**
 * A single row in the Email Log. Clicking anywhere on the row expands the full
 * plain-text body inline — no separate modal, no truncation.
 */
export function EmailLogRow({ row }: { row: EmailLogRow }) {
  const [expanded, setExpanded] = useState(false);

  const opened = !!row.opened_at;
  const clicked = !!row.clicked_at;
  const replied = !!row.replied_at;

  const ts = row.created_at
    ? new Date(row.created_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

  return (
    <div className="border-b border-border last:border-0">
      {/* Summary row — click to expand */}
      <button
        type="button"
        className="w-full px-4 py-3 text-left transition-colors hover:bg-surface"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[200px_1fr_130px_auto]">
          {/* Sub name */}
          <span className="truncate text-sm font-medium text-slate-900">
            {row.company_name ?? "Unknown sub"}
          </span>

          {/* Subject */}
          <span className="hidden truncate text-sm text-slate-700 sm:block">
            {row.subject ?? <span className="italic text-slate-400">No subject</span>}
          </span>

          {/* Timestamp */}
          <span className="hidden text-xs text-slate-500 sm:block">{ts}</span>

          {/* Badges */}
          <span className="flex shrink-0 items-center gap-1">
            {row.provider && (
              <span className="badge bg-slate-200 text-slate-600 text-[10px]">
                {row.provider}
              </span>
            )}
            {replied ? (
              <span className="badge bg-pursue/15 text-pursue text-[10px]" title="Sub replied">
                replied
              </span>
            ) : opened ? (
              <span className="badge bg-review/15 text-review text-[10px]" title="Email opened">
                opened
              </span>
            ) : null}
            {clicked && (
              <span className="badge bg-review/15 text-review text-[10px]" title="Link clicked">
                clicked
              </span>
            )}
            <span
              aria-hidden
              className={`ml-1 text-xs text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </span>
        </div>

        {/* Mobile: show subject below name */}
        <div className="mt-0.5 truncate text-xs text-slate-500 sm:hidden">
          {row.subject} · {ts}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border bg-surface px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              <span className="font-medium text-slate-700">To:</span>{" "}
              {row.recipient_email ?? (
                <span className="italic">address not recorded at time of send</span>
              )}
            </span>
            {row.opportunity_title && (
              <span>
                <span className="font-medium text-slate-700">Re:</span>{" "}
                {row.opportunity_title}
              </span>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
            {row.body ?? <span className="italic text-slate-400">No body stored.</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
