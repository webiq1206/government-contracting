import Link from "next/link";
import { emailLogPaged, EMAIL_LOG_PAGE_SIZE } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { EmailLogRow } from "@/components/email-log-row";

export const dynamic = "force-dynamic";

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams?: { q?: string; page?: string };
}) {
  const q = searchParams?.q?.trim() ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);

  const { rows, total } = await emailLogPaged({ page, q: q || undefined });
  const totalPages = Math.max(1, Math.ceil(total / EMAIL_LOG_PAGE_SIZE));

  function link(overrides: Record<string, string | number | undefined>) {
    const p = new URLSearchParams();
    const merged = { q: q || undefined, page, ...overrides };
    if (merged.q) p.set("q", String(merged.q));
    if (merged.page && Number(merged.page) > 1) p.set("page", String(merged.page));
    const qs = p.toString();
    return `/email-log${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        help={PAGE_HELP["email-log"]}
        title="Email Log"
        subtitle={
          total === 0
            ? "No outreach emails sent yet"
            : `${total.toLocaleString()} outbound email${total === 1 ? "" : "s"}${q ? " matching search" : ""}`
        }
      />

      {/* Search */}
      <div className="shrink-0 border-b border-border bg-background px-4 py-3">
        <form method="get" action="/email-log" className="flex items-center gap-2">
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
          {q && (
            <Link href="/email-log" className="text-xs text-slate-500 hover:text-accent">
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="scroll-thin flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-3xl">✉️</p>
            <p className="mt-3 text-base font-semibold text-foreground">
              {q ? "No emails match that search." : "No outreach emails sent yet."}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {q
                ? "Try a different sub name or subject."
                : "Emails will appear here once the outreach agent starts sending."}
            </p>
          </div>
        ) : (
          <>
            {/* Column headers */}
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-4 text-sm">
                {page > 1 ? (
                  <Link href={link({ page: page - 1 })} className="btn-ghost text-xs">
                    ← Previous
                  </Link>
                ) : (
                  <span className="btn-ghost text-xs opacity-40 cursor-default">← Previous</span>
                )}
                <span className="text-slate-500">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link href={link({ page: page + 1 })} className="btn-ghost text-xs">
                    Next →
                  </Link>
                ) : (
                  <span className="btn-ghost text-xs opacity-40 cursor-default">Next →</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
