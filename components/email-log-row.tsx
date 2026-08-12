"use client";

import { useState } from "react";
import type { EmailLogRow } from "@/lib/data";

/**
 * A single row in the Email Log. Clicking anywhere on the row expands the full
 * plain-text body inline. Outbound mail shows sent/opened/clicked/responded;
 * inbound replies show as a response.
 */
export function EmailLogRow({ row }: { row: EmailLogRow }) {
  const [expanded, setExpanded] = useState(false);

  const inbound = row.direction === "inbound";
  const opened = !inbound && !!row.opened_at;
  const clicked = !inbound && !!row.clicked_at;
  const responded = inbound || row.responded || !!row.replied_at;

  const ts = row.created_at
    ? new Date(row.created_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "-";

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        className="w-full px-4 py-3 text-left transition-colors hover:bg-surface"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[200px_1fr_130px_auto]">
          <span className="truncate text-sm font-medium text-foreground">
            {row.company_name ?? "Unknown sub"}
          </span>

          <span className="hidden truncate text-sm text-muted-foreground sm:block">
            {row.subject ?? <span className="italic text-muted-foreground">No subject</span>}
          </span>

          <span className="hidden text-xs text-muted-foreground sm:block">{ts}</span>

          <span className="flex shrink-0 items-center gap-1">
            {inbound ? (
              <span className="badge bg-pursue/15 text-pursue text-[10px]" title="They replied">
                response
              </span>
            ) : (
              <>
                <span className="badge bg-slate-200 text-slate-600 text-[10px] dark:bg-white/10 dark:text-foreground/70" title="Email sent">
                  sent
                </span>
                {opened && (
                  <span className="badge bg-review/15 text-review text-[10px]" title="Email opened">
                    opened
                  </span>
                )}
                {clicked && (
                  <span className="badge bg-review/15 text-review text-[10px]" title="Link clicked">
                    clicked
                  </span>
                )}
                {responded && (
                  <span className="badge bg-pursue/15 text-pursue text-[10px]" title="Sub replied">
                    responded
                  </span>
                )}
              </>
            )}
            {row.provider && !inbound && (
              <span className="badge bg-slate-200 text-slate-600 text-[10px] dark:bg-white/10 dark:text-foreground/70">
                {row.provider}
              </span>
            )}
            <span
              aria-hidden
              className={`ml-1 text-xs text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </span>
        </div>

        <div className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
          {row.subject} · {ts}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-surface px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{inbound ? "From:" : "To:"}</span>{" "}
              {row.recipient_email ?? (
                <span className="italic">
                  {inbound ? "address not recorded" : "address not recorded at time of send"}
                </span>
              )}
            </span>
            {row.opportunity_title && (
              <span>
                <span className="font-medium text-foreground">Re:</span>{" "}
                {row.opportunity_title}
              </span>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
            {row.body ?? <span className="italic text-muted-foreground">No body stored.</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
