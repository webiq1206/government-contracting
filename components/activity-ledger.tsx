"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ActivityRow } from "@/lib/activity/read";
const categories = [
  "email",
  "sms",
  "call",
  "note",
  "bid",
  "quote",
  "reply",
  "document",
  "opportunity",
  "contract",
  "compliance",
  "automation",
  "api",
  "billing",
  "settings",
];
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
type Data = {
  viewScope: string;
  rows: ActivityRow[];
  summary: {
    total: number;
    attention: number;
    sent: number;
    received: number;
    bids: number;
  };
  actors: string[];
  page: number;
  pageSize: number;
};
export function ActivityLedger() {
  const params = useSearchParams();
  const qs = params.toString();
  const filters = Object.fromEntries(params);
  const [viewError, setViewError] = useState("");
  const setFilters = (next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>), replace = false) => {
    const values = typeof next === "function" ? next(filters) : next;
    const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value)).toString();
    // Native history retains Next's state and lets Back restore the selected view.
    if (query !== qs) history[replace ? "replaceState" : "pushState"](null, "", "/activity" + (query ? "?" + query : ""));
  };
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0),
    [saved, setSaved] = useState<
      { name: string; filters: Record<string, string> }[]
    >([]),
    [viewName, setViewName] = useState("");
  useEffect(() => {
    if (!data?.viewScope) return;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem("activity-views:" + data.viewScope) || "[]");
      setSaved(Array.isArray(stored) ? stored.filter((entry): entry is { name: string; filters: Record<string, string> } =>
        entry != null && typeof entry.name === "string" && entry.filters != null && typeof entry.filters === "object" &&
        !Array.isArray(entry.filters) && Object.values(entry.filters).every(value => typeof value === "string")) : []);
    } catch {
      setSaved([]);
    }
  }, [data?.viewScope]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("The ledger took too long to load. Try again.")), 20_000);
    setLoading(true);
    setError("");
    fetch("/api/activity?" + qs, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("Your activity could not be loaded. Try again.");
        const body = await r.json();
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (controller.signal.aborted && controller.signal.reason?.name === "AbortError") return;
        if (e.name !== "AbortError") setError("Your activity could not be loaded. Check your connection and try again.");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!controller.signal.aborted || controller.signal.reason?.name !== "AbortError") setLoading(false);
      });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [qs, refresh]);
  const change = (key: string, value: string) =>
    setFilters((f) => ({ ...f, [key]: value, page: "1" }), key === "q");
  const persistViews = (next: typeof saved) => {
    try {
      localStorage.setItem("activity-views:" + data?.viewScope, JSON.stringify(next));
      setSaved(next);
      setViewError("");
      return true;
    } catch {
      setViewError("This browser could not save your view. Your filters still work. You can bookmark this page instead.");
      return false;
    }
  };
  const save = () => {
    if (!viewName.trim()) return;
    const next = [
      ...saved.filter((s) => s.name !== viewName.trim()),
      { name: viewName.trim(), filters },
    ].slice(-12);
    if (persistViews(next)) setViewName("");
  };
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <details className="rounded-lg border border-border bg-surface px-4 py-2">
        <summary className="cursor-pointer text-sm font-medium">How to read this ledger</summary>
        <div className="pb-2 text-sm text-muted-foreground">
          <p className="mt-2">Follow messages, bids, replies, documents and automation. Open a record to see what happened. Times use your device’s timezone; date filters use UTC.</p>
          <p className="mt-2">Historical snapshots show the latest saved state when this ledger was introduced. They do not reconstruct earlier changes. Sent means handed to the email provider; delivered requires delivery evidence.</p>
        </div>
      </details>
      <details className="card"><summary className="cursor-pointer font-semibold">Quick views</summary><div className="mt-3 flex flex-wrap gap-2" aria-label="Quick views">
        {[
          ["All activity", {}],
          ["Needs attention", { attention: "1" }],
          ["Emails sent", { category: "email", status: "sent" }],
          ["Received", { status: "received" }],
          ["Bid work", { category: "bid" }],
          ["Automation", { category: "automation" }],
        ].map(([name, f]) => (
          <button
            className="btn-secondary"
            key={String(name)}
            onClick={() => setFilters(f as Record<string, string>)}
          >
            {String(name)}
          </button>
        ))}
      </div></details>
      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="text-sm sm:col-span-2">
          Search messages, subjects, recipients or opportunities
          <input
            className="input mt-1 w-full"
            placeholder="Company, email, bid or phrase…"
            value={filters.q || ""}
            onChange={(e) => change("q", e.target.value)}
          />
        </label>
        <details className="sm:col-span-2 lg:col-span-4"><summary className="cursor-pointer text-sm font-medium">More filters</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          Activity type
          <select
            className="input mt-1 w-full"
            value={filters.category || ""}
            onChange={(e) => change("category", e.target.value)}
          >
            <option value="">All types</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select
            className="input mt-1 w-full"
            value={filters.status || ""}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {[
              "sent",
              "delivered",
              "received",
              "draft",
              "submitted",
              "approved",
              "sending",
              "ready_for_review",
              "receipt_confirmed",
              "accepted",
              "failed",
              "bounced",
              "deferred",
              "needs_review",
              "needs_matching",
              "pending",
              "ok",
              "skipped",
              "removed",
            ].map((c) => (
              <option value={c} key={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          From
          <input
            className="input mt-1 w-full"
            type="date"
            value={filters.from || ""}
            onChange={(e) => change("from", e.target.value)}
          />
        </label>
        <label className="text-sm">
          Through
          <input
            className="input mt-1 w-full"
            type="date"
            value={filters.to || ""}
            onChange={(e) => change("to", e.target.value)}
          />
        </label>
        <label className="text-sm">
          Recorded actor
          <select
            className="input mt-1 w-full"
            value={filters.actor || ""}
            onChange={(e) => change("actor", e.target.value)}
          >
            <option value="">Everyone and all agents</option>
            {data?.actors.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Order
          <select
            className="input mt-1 w-full"
            value={filters.sort || "newest"}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        </div></details>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-secondary"
          onClick={() => setRefresh((x) => x + 1)}
        >
          Refresh
        </button>
        <button className="btn-secondary" onClick={() => setFilters({})}>
          Clear filters
        </button>
        <details><summary className="cursor-pointer text-sm">Export or save this view</summary><div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          className="btn-secondary"
          href={"/api/activity?" + qs + "&format=csv"}
        >
          Export all matching activity (CSV)
        </a>
        <label className="sr-only" htmlFor="activity-view-name">
          Name this view
        </label>
        <input
          id="activity-view-name"
          className="input"
          placeholder="Name this view"
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          maxLength={60}
        />
        <button className="btn-secondary" onClick={save} disabled={!data}>
          Save view on this device
        </button>
        </div></details>
      </div>
      {Object.values(filters).some(Boolean) && <p className="text-xs text-muted-foreground">Current filters: {Object.entries(filters).filter(([,v])=>v).map(([k,v])=>k==="attention"?"Needs attention":`${label(k)}: ${label(v)}`).join(" · ")}</p>}
      {viewError && <p role="alert" className="text-sm text-risk">{viewError}</p>}
      {saved.length > 0 && (
        <details><summary className="cursor-pointer text-sm">Saved views</summary><div className="flex flex-wrap gap-2">
          {saved.map((s) => (
            <span
              className="inline-flex rounded border border-border"
              key={s.name}
            >
              <button
                className="min-h-11 px-3 py-2 text-sm"
                onClick={() => setFilters(s.filters)}
              >
                {s.name}
              </button>
              <button
                className="min-h-11 min-w-11 px-3"
                aria-label={"Remove saved view " + s.name}
                onClick={() => {
                  const next = saved.filter((v) => v.name !== s.name);
                  persistViews(next);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div></details>
      )}
      {error ? (
        <div role="alert" className="rounded border border-risk p-4">
          {error}
          <button
            className="btn-secondary ml-3"
            onClick={() => setRefresh((x) => x + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <details className="rounded-lg border border-border bg-surface px-4 py-2">
            <summary className="cursor-pointer text-sm font-medium">Activity totals{data && !loading ? ` (${data.summary.total.toLocaleString()} matching records)` : ""}</summary>
          <div
            className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5"
            aria-live="polite"
          >
            {[
              ["Matching records", data?.summary.total],
              ["Attention records", data?.summary.attention],
              ["Email send records", data?.summary.sent],
              ["Received records", data?.summary.received],
              ["Bid work records", data?.summary.bids],
            ].map(([t, n]) => (
              <div
                className="rounded-xl border border-border bg-surface p-4"
                key={t}
              >
                <div className="text-xs text-muted-foreground">{t}</div>
                <div className="mt-1 text-2xl font-semibold">
                  {loading ? "…" : Number(n || 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Counts include matching history entries, including later updates to
            the same item. “Needs attention” finds recorded states; open the
            source to check its current status.
          </p>
          </details>
          <div aria-busy={loading} className={loading ? "opacity-60" : ""}>
            {data?.rows.map((r) => (
              <details
                key={r.id}
                className="mb-3 overflow-hidden rounded-xl border border-border bg-surface"
              >
                <summary className="cursor-pointer p-4">
                  <div className="inline-flex w-[95%] flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {r.category}
                      </span>
                      <span className="text-xs font-medium">
                        {label(r.status)}
                      </span>
                      <h3 className="mt-1 break-words font-medium">
                        {r.title}
                      </h3>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {[r.company, r.opportunity, r.detail.recipient_email]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      <time dateTime={r.occurred_at}>
                        {new Date(r.occurred_at).toLocaleString()}
                      </time>
                      <p className="mt-1">{label(r.actor)}</p>
                      {r.historical && (
                        <p className="mt-1">Historical snapshot</p>
                      )}
                    </div>
                  </div>
                </summary>
                <div className="space-y-4 border-t border-border p-4">
                  <div className="flex flex-wrap gap-3">
                    {r.opportunity_id && (
                      <Link
                        className="text-sm underline"
                        href={"/opportunity/" + r.opportunity_id}
                      >
                        Open opportunity
                      </Link>
                    )}
                    {r.subcontractor_id && (
                      <Link
                        className="text-sm underline"
                        href={"/subs/" + r.subcontractor_id}
                      >
                        Open subcontractor
                      </Link>
                    )}
                    {["email", "reply", "sms"].includes(r.category) && (
                      <Link
                        className="text-sm underline"
                        href="/communications"
                      >
                        Open communications
                      </Link>
                    )}
                    {r.category === "api" && (
                      <Link
                        className="text-sm underline"
                        href="/settings/api-usage"
                      >
                        Open API usage
                      </Link>
                    )}
                  </div>
                  {r.source_table === "documents" &&
                    r.operation !== "DELETE" && (
                      <a
                        className="text-sm underline"
                        href={"/api/documents/" + r.source_id + "/open"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open document
                      </a>
                    )}
                  <dl className="space-y-3">
                    {Object.entries(r.detail)
                      .filter(
                        ([, v]) =>
                          v !== null && v !== "" && JSON.stringify(v) !== "[]",
                      )
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-xs font-semibold text-muted-foreground">
                            {k === "recipient_email"
                              ? r.detail.direction === "inbound"
                                ? "From"
                                : "To"
                              : label(k)}
                          </dt>
                          <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {typeof v === "object"
                              ? JSON.stringify(v, null, 2)
                              : String(v)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <p className="break-all text-xs text-muted-foreground">
                    Record {r.source_id} · {label(r.operation)} · Ledger entry{" "}
                    {r.id}
                  </p>
                </div>
              </details>
            ))}
            {!loading && data?.rows.length === 0 && (
              <div className="rounded-xl border border-border p-10 text-center">
                <h3 className="font-semibold">No matching activity</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try a wider date range or clear your filters. New recorded
                  actions will appear here.
                </p>
              </div>
            )}
          </div>
          {data && (
            <nav
              className="flex items-center justify-between pb-6"
              aria-label="Activity pages"
            >
              <button
                className="btn-secondary"
                disabled={loading || data.page <= 1}
                onClick={() =>
                  setFilters((f) => ({ ...f, page: String(data.page - 1) }))
                }
              >
                Previous
              </button>
              <span className="text-sm">
                Page {data.page} of{" "}
                {Math.max(1, Math.ceil(data.summary.total / data.pageSize))}
              </span>
              <button
                className="btn-secondary"
                disabled={
                  loading || data.page * data.pageSize >= data.summary.total
                }
                onClick={() =>
                  setFilters((f) => ({ ...f, page: String(data.page + 1) }))
                }
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
