"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/data-table";
import { ContactQuickEdit } from "@/components/contact-quick-edit";
import type { FilterValues, PageState, SortState } from "@/lib/domain/table-view";
import type { Subcontractor } from "@/lib/types";
import { subState, SUB_STATE_TONE } from "@/lib/domain/sub-state";

/**
 * The roster's read of a row, from the same function every other surface uses.
 *
 * `unmet_required_docs` is optional on the type: a read that did not count
 * them leaves it undefined, and undefined is not zero. Treating it as zero
 * here would have the roster promise clean paperwork it never checked.
 */
function rowState(s: Subcontractor) {
  const unmet = s.unmet_required_docs;
  return subState({
    samExcluded: Boolean(s.sam_excluded),
    blacklisted: Boolean(s.blacklisted),
    blacklistReason: s.blacklist_reason ?? null,
    archivedAt: s.archived_at ?? null,
    archivedReason: s.archived_reason ?? null,
    mergedInto: s.merged_into ?? null,
    email: s.email,
    emailVerified: Boolean(s.email_verified),
    phone: s.phone,
    missingDocuments: unmet && unmet > 0 ? [`${unmet} required for award`] : [],
    preferred: Boolean(s.is_preferred),
  });
}

/**
 * The roster, as a table you can actually work.
 *
 * Client-side only for what the browser owns -- which rows are selected, which
 * columns are shown. Filtering, sorting and paging all happened on the server
 * before this rendered, because five hundred subcontractors should not be sent
 * to a phone so that JavaScript can hide four hundred and fifty of them.
 */
export function SubsTable({
  rows,
  total,
  filters,
  sort,
  paging,
  emptyState,
  peekBase,
}: {
  rows: Subcontractor[];
  total: number;
  filters: FilterValues;
  sort: SortState;
  paging: PageState;
  emptyState: React.ReactNode;
  /**
   * The current list URL with the peek removed, ready to have one appended.
   * Built on the server: a function prop cannot cross into a client component,
   * and rebuilding the query here from `useSearchParams` would be a second
   * implementation of the same string.
   */
  peekBase: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /*
   * Held here rather than inside the bulk bar. The bar only exists while rows
   * are selected, so a result kept there vanished the moment the action
   * cleared the selection, taking the sentence saying what changed and the
   * control that undoes it with it. Those are the whole point.
   */
  const [outcome, setOutcome] = useState<{ message: string; batchId: string | null } | null>(null);

  const columns: Column<Subcontractor>[] = [
    {
      key: "company_name",
      header: "Company",
      sortable: true,
      render: (s) => (
        <>
          <Link href={`/subs/${s.id}`} className="font-medium text-foreground hover:text-gold-text">
            {s.is_preferred ? "★ " : ""}
            {s.company_name}
          </Link>
          {s.owner_name && (
            <div className="text-xs text-muted-foreground">{s.owner_name}</div>
          )}
        </>
      ),
    },
    {
      key: "trades",
      header: "Trades",
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {(s.trade_categories ?? []).slice(0, 3).map((t) => (
            <span key={t} className="badge bg-muted text-muted-foreground">
              {t}
            </span>
          ))}
          {(s.trade_categories?.length ?? 0) > 3 && (
            <span className="badge bg-muted text-muted-foreground">
              +{(s.trade_categories?.length ?? 0) - 3}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "state",
      header: "Location",
      sortable: true,
      render: (s) => [s.city, s.state].filter(Boolean).join(", ") || "-",
    },
    {
      key: "contact",
      header: "Email",
      hint: "Whether outreach can actually reach this firm.",
      render: (s) => (
        <span className="whitespace-nowrap">
          <ContactQuickEdit
            subId={s.id}
            companyName={s.company_name}
            email={s.email}
            phone={s.phone}
            website={s.website}
            ownerName={s.owner_name}
            className="mr-1 align-middle"
          />
          {s.email && s.email_verified ? (
            <span className="badge bg-pursue/15 text-pursue" title={s.email}>
              Verified
            </span>
          ) : s.email ? (
            <span className="badge bg-review/15 text-review" title={s.email}>
              Unverified
            </span>
          ) : s.contact_status ? (
            <span className="badge bg-muted text-muted-foreground">None found</span>
          ) : (
            <span
              className="badge bg-muted text-muted-foreground"
              title="Sub Verify has not looked for an address yet"
            >
              Not checked
            </span>
          )}
        </span>
      ),
    },
    {
      key: "reliability_score",
      header: "Reliability",
      sortable: true,
      numeric: true,
      hint: "0-100, from six things: whether they answer, whether they quote, whether the quote arrives by the date they were given, whether it covers the scope, how the work went, and how often they have backed out. Blank means not enough history to score, which is not a low score.",
      render: (s) =>
        s.reliability_score != null ? (
          <span className="font-semibold text-foreground">{s.reliability_score}</span>
        ) : (
          /*
            Words, not a dash. A dash reads as a gap in the table; this is a
            statement about the firm, and the difference matters on the column
            an operator sorts by to decide who to approach first.
          */
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            No history yet
          </span>
        ),
    },
    {
      key: "google_rating",
      header: "Rating",
      sortable: true,
      numeric: true,
      render: (s) =>
        s.google_rating != null ? (
          <span>
            {Number(s.google_rating).toFixed(1)}
            <span className="ml-1 text-xs text-muted-foreground">({s.review_count ?? 0})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "last_contacted",
      header: "Last contacted",
      sortable: true,
      optional: true,
      render: (s) =>
        s.last_contacted ? (
          new Date(s.last_contacted).toLocaleDateString()
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      key: "license_status",
      header: "Licence",
      sortable: true,
      optional: true,
      render: (s) =>
        s.license_status ? (
          <span
            className={`badge ${
              s.license_status.toLowerCase() === "active"
                ? "bg-pursue/15 text-pursue"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {s.license_status}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      /*
       * `record_state`, not `state`.
       *
       * Two columns were keyed "state": this badge and the Location column
       * eleven rows up. DataTable uses the key as the React key for the header
       * and body cells and as the sort parameter, so the table rendered with a
       * duplicate-key warning and the column chooser could not tell the two
       * apart. This one is not sortable, so no saved view or bookmarked URL
       * names it and renaming it changes nothing an operator can see.
       */
      key: "record_state",
      header: "State",
      /*
       * One badge, from the same function the record page and the quick look
       * use. The roster used to show SAM exclusion and a block side by side
       * and say nothing at all about lapsed paperwork or an unusable address,
       * so a firm could read clean here and blocked on its own page.
       */
      render: (s) => {
        const v = rowState(s);
        return (
          <span className={`badge ${SUB_STATE_TONE[v.state]}`} title={v.detail}>
            {v.label}
          </span>
        );
      },
    },
    {
      key: "flags",
      header: "Flags",
      optional: true,
      render: (s) =>
        s.sb_certified ? (
          <span
            className="badge bg-gold/15 text-gold-text"
            title="Certified small business: counts toward federal small-business requirements"
          >
            Small business
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "peek",
      header: "",
      render: (s) => (
        <Link
          href={`${peekBase}peek=${s.id}`}
          scroll={false}
          className="tap text-xs text-slate-500 underline-offset-2 hover:text-accent"
        >
          Quick look
        </Link>
      ),
    },
  ];

  return (
    <>
      {outcome && (
        <BulkOutcomeBanner
          outcome={outcome}
          onDismiss={() => setOutcome(null)}
          onUndone={(message) => {
            setOutcome({ message, batchId: null });
            router.refresh();
          }}
        />
      )}
      <DataTable
      rows={rows}
      columns={columns}
      pathname="/subs"
      filters={filters}
      sort={sort}
      paging={paging}
      total={total}
      prefsKey="brostco.subs.table"
      card={(s) => <SubCard row={s} peekBase={peekBase} selected={selected.has(s.id)}
        onToggle={() => setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(s.id)) next.delete(s.id);
          else next.add(s.id);
          return next;
        })} />}
      emptyState={emptyState}
      selection={{
        selected,
        onToggle: (id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        onToggleAll: (ids) =>
          setSelected((prev) => {
            if (ids.length === 0) return new Set();
            const all = ids.every((i) => prev.has(i));
            const next = new Set(prev);
            for (const i of ids) {
              if (all) next.delete(i);
              else next.add(i);
            }
            return next;
          }),
        bar: (ids) => (
          <BulkBar
            ids={ids}
            onResult={(r) => {
              setOutcome(r);
              // Cleared only when something actually happened, so a refused
              // action leaves the selection to try again with.
              if (r.batchId !== undefined) setSelected(new Set());
              router.refresh();
            }}
          />
        ),
      }}
      />
    </>
  );
}

/**
 * One firm on a phone.
 *
 * The table is 52rem wide inside a horizontal scroller, so reading one row on
 * a 390px screen means scrolling sideways until the company name has left the
 * screen, and the state badge and the way to reach them are at opposite ends
 * of that scroll. Here the three things a phone is actually used for are
 * together: who they are, where they stand, and the two taps that reach them.
 */
function SubCard({
  row, peekBase, selected, onToggle,
}: {
  row: Subcontractor;
  peekBase: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const v = rowState(row);
  const area = [row.city, row.state].filter(Boolean).join(", ");
  const trades = (row.trade_categories ?? []).join(", ");
  const tel = row.phone ? `tel:${row.phone.replace(/[^\d+]/g, "")}` : null;
  /*
   * The address is offered only when outreach would actually use it. An
   * unverified address opens a mail client addressed to somewhere that has
   * not passed a check, which is how a bid loses a quote to a bounce nobody
   * saw.
   */
  const mail = row.email && row.email_verified ? `mailto:${row.email}` : null;

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.company_name}`}
        />
        <div className="min-w-0 flex-1">
          <Link href={`/subs/${row.id}`} className="block truncate font-medium text-foreground">
            {row.company_name}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[trades, area].filter(Boolean).join(" \u00b7 ") || "Nothing on file about where they work"}
          </p>
          <span className={`badge mt-1.5 inline-block ${SUB_STATE_TONE[v.state]}`}>{v.label}</span>
          <p className="mt-1 text-xs text-muted-foreground">{v.detail}</p>
        </div>
      </div>

      {/*
        The contact bar. Pinned to the bottom of the card rather than to the
        viewport: a bar fixed to the screen can only ever act on one firm, and
        a list of firms is exactly where somebody is choosing between them.
        Dimmed rather than hidden when a channel is missing, so the row
        doubles as a contact-data health check.
      */}
      <div className="flex divide-x divide-border border-t border-border">
        {tel ? (
          <a href={tel} className="tap flex min-h-11 flex-1 items-center justify-center text-sm text-accent">
            Call
          </a>
        ) : (
          <span className="flex min-h-11 flex-1 items-center justify-center text-sm text-muted-foreground">
            No phone
          </span>
        )}
        {mail ? (
          <a href={mail} className="tap flex min-h-11 flex-1 items-center justify-center text-sm text-accent">
            Email
          </a>
        ) : (
          <span className="flex min-h-11 flex-1 items-center justify-center text-sm text-muted-foreground">
            {row.email ? "Email unverified" : "No email"}
          </span>
        )}
        <Link
          href={`${peekBase}peek=${row.id}`}
          scroll={false}
          className="tap flex min-h-11 flex-1 items-center justify-center text-sm text-accent"
        >
          Quick look
        </Link>
      </div>
    </div>
  );
}

/**
 * What the last bulk change did, and the control that takes it back.
 *
 * Outside the selection bar on purpose: acting clears the selection, and a
 * message that disappears with it is one nobody reads. It stays until
 * dismissed, because "173 updated, 27 left alone because they are marked do
 * not use" is a sentence somebody may want to act on rather than glance at.
 */
function BulkOutcomeBanner({
  outcome, onDismiss, onUndone,
}: {
  outcome: { message: string; batchId: string | null };
  onDismiss: () => void;
  onUndone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2">
      <span role="status" className="text-sm text-foreground">{outcome.message}</span>
      {outcome.batchId && (
        <button
          type="button"
          className="tap text-xs text-accent hover:underline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch("/api/subs/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "undo", batch_id: outcome.batchId }),
              });
              const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
              onUndone(res.ok ? (data.message ?? "Taken back.") : (data.error ?? "That could not be taken back."));
            } catch {
              onUndone("Could not reach the server. Nothing was taken back.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Taking it back\u2026" : "Take that back"}
        </button>
      )}
      <button type="button" className="tap ml-auto text-xs text-muted-foreground hover:text-foreground"
        onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * The bulk actions, each one recorded so it can be taken back.
 *
 * These were left unbuilt with a note saying why: they write to a roster
 * shared across live bids, and a button that changes two hundred rows with no
 * way back is worse than no button. So the result of every write is a
 * sentence saying what changed, what it left alone and why, and a control
 * that undoes exactly the rows it touched.
 */
function BulkBar({
  ids, onResult,
}: {
  ids: string[];
  onResult: (r: { message: string; batchId: string | null }) => void;
}) {
  const [panel, setPanel] = useState<"tag" | "archive" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch("/api/subs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; message?: string; batchId?: string | null;
      };
      if (!res.ok) {
        /*
         * A refusal stays in the bar with the selection intact. Nothing
         * happened, so there is nothing to undo and no reason to make
         * somebody pick the same rows again.
         */
        setRefusal(data.error ?? "That did not work.");
        return;
      }
      setPanel(null);
      setText("");
      onResult({ message: data.message ?? "Done.", batchId: data.batchId ?? null });
    } catch {
      setRefusal("Could not reach the server. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <a
        className="btn-ghost h-8 text-xs"
        href={`/api/subs/export?ids=${encodeURIComponent(ids.join(","))}`}
      >
        Export {ids.length} as CSV
      </a>
      <button type="button" className="btn-ghost h-8 text-xs" disabled={busy}
        onClick={() => void run({ action: "verify", ids })}>
        Re-check contact details
      </button>
      <button type="button" className="btn-ghost h-8 text-xs" aria-expanded={panel === "tag"}
        onClick={() => setPanel(panel === "tag" ? null : "tag")}>
        Tag
      </button>
      <button type="button" className="btn-ghost h-8 text-xs" aria-expanded={panel === "archive"}
        onClick={() => setPanel(panel === "archive" ? null : "archive")}>
        Put aside
      </button>

      {panel && (
        <div className="flex w-full flex-wrap items-center gap-2">
          <input
            className="input h-9 w-full sm:w-64"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={panel === "tag" ? "Tag name" : "Why, so the next person is not guessing"}
          />
          <button type="button" className="btn h-8 text-xs" disabled={busy || !text.trim()}
            onClick={() =>
              void run(
                panel === "tag"
                  ? { action: "tag", ids, tag: text.trim() }
                  : { action: "archive", ids, reason: text.trim() }
              )
            }>
            {busy ? "Working\u2026" : panel === "tag" ? `Tag ${ids.length}` : `Put ${ids.length} aside`}
          </button>
          {panel === "tag" && (
            <button type="button" className="btn-ghost h-8 text-xs" disabled={busy || !text.trim()}
              onClick={() => void run({ action: "untag", ids, tag: text.trim() })}>
              Remove instead
            </button>
          )}
          <button type="button" className="btn-ghost h-8 text-xs" onClick={() => setPanel(null)}>
            Cancel
          </button>
        </div>
      )}

      {refusal && (
        <p role="status" className="w-full text-xs text-risk">{refusal}</p>
      )}
    </div>
  );
}
