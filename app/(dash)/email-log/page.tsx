import Link from "next/link";
import { emailLogPaged, EMAIL_LOG_PAGE_SIZE } from "@/lib/data";
import { PageFrame } from "@/components/page-frame";
import { PageToolbar, PageToolbarChips } from "@/components/page-toolbar";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { EmailLogRow } from "@/components/email-log-row";
import {
  EMAIL_LOG_STATUSES,
  EMAIL_LOG_STATUS_LABELS,
  parseEmailLogStatus,
} from "@/lib/domain/email-log";

export const dynamic = "force-dynamic";

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams?: { q?: string; page?: string; status?: string };
}) {
  const q = searchParams?.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const status = parseEmailLogStatus(searchParams?.status);

  const { rows, total, counts } = await emailLogPaged({
    page,
    q: q || undefined,
    status,
  });
  const totalPages = Math.max(1, Math.ceil(total / EMAIL_LOG_PAGE_SIZE));

  function link(overrides: Record<string, string | number | undefined>) {
    const p = new URLSearchParams();
    const merged = {
      q: q || undefined,
      status: status === "all" ? undefined : status,
      page,
      ...overrides,
    };
    if (merged.q) p.set("q", String(merged.q));
    if (merged.status) p.set("status", String(merged.status));
    if (merged.page && Number(merged.page) > 1) p.set("page", String(merged.page));
    const qs = p.toString();
    return `/email-log${qs ? `?${qs}` : ""}`;
  }

  const filterActive = status !== "all" || Boolean(q);
  const emptyTitle = q
    ? "No emails match that search"
    : status !== "all"
      ? `No ${EMAIL_LOG_STATUS_LABELS[status].toLowerCase()} emails`
      : "No outreach emails sent yet";
  const emptyDescription = q
    ? "Try a different sub name or subject keyword."
    : status !== "all"
      ? "Nothing in this status yet. Try All, or another filter."
      : "Emails appear here once outreach runs on pursued opportunities.";

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["email-log"]}
        title="Email Log"
        status={
          total === 0
            ? "No emails in this view"
            : `${total.toLocaleString()} email${total === 1 ? "" : "s"}${
                q || status !== "all" ? " in this view" : ""
              }`
        }
        explanation="Every subcontractor email Brost Co sends or receives, with open, click, and response status."
      />

      <PageToolbar>
        <form method="get" action="/email-log" className="flex flex-wrap items-center gap-2">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by sub name or subject…"
            className="input w-full max-w-sm"
          />
          <button type="submit" className="btn-ghost text-sm">
            Search
          </button>
          {filterActive && (
            <Link href="/email-log" className="text-xs text-slate-500 hover:text-accent">
              Clear
            </Link>
          )}
        </form>
        <PageToolbarChips aria-label="Email status filters" className="mt-2">
          {EMAIL_LOG_STATUSES.map((key) => (
            <StatusChip
              key={key}
              href={link({ status: key === "all" ? undefined : key, page: 1 })}
              active={status === key}
              label={EMAIL_LOG_STATUS_LABELS[key]}
              count={counts[key]}
            />
          ))}
        </PageToolbarChips>
      </PageToolbar>

      <div className="scroll-thin flex-1 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={
              filterActive ? (
                <Link href="/email-log" className="btn-ghost text-sm">
                  Show all emails
                </Link>
              ) : (
                <Link href="/pipeline" className="btn-ghost text-sm">
                  Open opportunities
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="hidden border-b border-border bg-surface px-4 py-2 sm:grid sm:grid-cols-[200px_1fr_130px_auto] sm:gap-2">
              <span className="eyebrow text-[10px]">Sub</span>
              <span className="eyebrow text-[10px]">Subject</span>
              <span className="eyebrow text-[10px]">Sent</span>
              <span className="eyebrow text-[10px]">Status</span>
            </div>

            <div className="divide-y-0">
              {rows.map((row) => (
                <EmailLogRow key={row.id} row={row} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-4 text-sm">
                {page > 1 ? (
                  <Link href={link({ page: page - 1 })} className="btn-ghost text-xs">
                    ← Previous
                  </Link>
                ) : (
                  <span className="btn-ghost text-xs cursor-default opacity-40">← Previous</span>
                )}
                <span className="text-slate-500">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link href={link({ page: page + 1 })} className="btn-ghost text-xs">
                    Next →
                  </Link>
                ) : (
                  <span className="btn-ghost text-xs cursor-default opacity-40">Next →</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatusChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-gold bg-gold/15 text-foreground"
          : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      }`}
    >
      {label}
      <span className={active ? "text-foreground/70" : "text-muted-foreground/80"}>
        {count.toLocaleString()}
      </span>
    </Link>
  );
}