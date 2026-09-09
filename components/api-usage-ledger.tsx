"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { ApiSpendingControls } from "./api-spending-controls";
type Row = Record<string, any>;
const money = (n: unknown) =>
  n == null
    ? "Not confirmed"
    : Number(n) > 0 && Number(n) < 0.000001
      ? "Less than $0.000001"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 6,
        }).format(Number(n));
const field = "rounded border border-border bg-white px-3 py-2 text-sm min-w-0";
export function ApiUsageLedger({ admin = false }: { admin?: boolean }) {
  const endpoint = admin ? "/api/admin/api-usage" : "/api/api-usage";
  const [filters, setFilters] = useState<Record<string, string>>({
    period: "month",
    page: "1",
  });
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null),
    [message, setMessage] = useState("");
  const saving = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selected]);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    fetch(`${endpoint}?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setData(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [endpoint, query, version]);
  function filter(key: string, value: string) {
    setFilters((f) => ({
      ...f,
      [key]: value,
      page: key === "page" ? value : "1",
    }));
  }
  async function save(body: Row) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(
        result.invoiceId
          ? `Draft invoice ${result.invoiceId} is ready in Stripe. Review and finalize it there.`
          : "Saved.",
      );
      setVersion((v) => v + 1);
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const summary = data?.summary ?? {};
  const choices = (key: string) =>
    Array.from(
      new Set((data?.options ?? []).map((r: Row) => String(r[key]))),
    ) as string[];
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {admin
          ? "See who used each service, which account paid, and what belongs on the customer’s bill."
          : "See your API usage and choose who provides each connected service."}{" "}
        Dates use UTC.
      </p>
      {error && (
        <div role="alert" className="card border-risk text-risk">
          {error}{" "}
          <button
            onClick={() => setVersion((v) => v + 1)}
            className="underline"
          >
            Retry
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="text-pursue">
          {message}
        </p>
      )}
      {data?.budget && <ApiSpendingControls key={JSON.stringify(data.budget)} budget={data.budget} editable={admin || data.canManageBudget === true} save={save} busy={busy} />}
      {admin && data && <LimitSettings data={data} save={save} busy={busy} />}
      <form
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Usage filters"
      >
        <label className="text-xs">
          Time range
          <select
            className={`${field} mt-1 w-full`}
            value={filters.period}
            onChange={(e) => {
              setFilters((f) => ({
                ...f,
                period: e.target.value,
                from: "",
                to: "",
                page: "1",
              }));
            }}
          >
            <option value="today">Today</option>
            <option value="week">Past 7 days</option>
            <option value="month">This month</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {admin && (
          <label className="text-xs">
            Tenant
            <select
              className={`${field} mt-1 w-full`}
              value={filters.tenant ?? ""}
              onChange={(e) => filter("tenant", e.target.value)}
            >
              <option value="">All tenants</option>
              {data?.tenants?.map((t: Row) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(["provider", "service", "feature"] as const).map((key) => (
          <label key={key} className="text-xs">
            {key === "service"
              ? "Model or service"
              : key === "feature"
                ? "Feature or workflow"
                : "Provider"}
            <select
              className={`${field} mt-1 w-full`}
              value={filters[key] ?? ""}
              onChange={(e) => filter(key, e.target.value)}
            >
              <option value="">All</option>
              {choices(key).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        <label className="text-xs">
          Who provides the API?
          <select
            className={`${field} mt-1 w-full`}
            value={filters.source ?? ""}
            onChange={(e) => filter("source", e.target.value)}
          >
            <option value="">Both</option>
            <option value="platform">Platform API</option>
            <option value="tenant">Tenant API</option>
          </select>
        </label>
        <label className="text-xs">
          Request result
          <select
            className={`${field} mt-1 w-full`}
            value={filters.outcome ?? ""}
            onChange={(e) => filter("outcome", e.target.value)}
          >
            <option value="">All results</option>
            <option value="success">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="pending">Awaiting result</option>
          </select>
        </label>
        <label className="text-xs">
          Billing status
          <select
            className={`${field} mt-1 w-full`}
            value={filters.status ?? ""}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {[
              "review",
              "unbilled",
              "pending",
              "billed",
              "paid",
              "credited",
              "refunded",
              "not_billable",
            ].map((v) => (
              <option key={v} value={v}>
                {v.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Sort by
          <select
            className={`${field} mt-1 w-full`}
            value={filters.sort ?? "newest"}
            onChange={(e) => filter("sort", e.target.value)}
          >
            {[
              ["newest", "Newest activity"],
              ["charge", "Highest tenant charge"],
              ["usage", "Most requests"],
              ["tenant", "Tenant"],
              ["provider", "Provider"],
              ...(admin
                ? [
                    ["cost", "Highest actual cost"],
                    ["margin", "Highest margin"],
                  ]
                : []),
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {["from", "to"].map((key) => (
          <label key={key} className="text-xs">
            {key === "from" ? "Start date" : "End date"}
            <input
              type="date"
              className={`${field} mt-1 w-full`}
              value={filters[key] ?? ""}
              onChange={(e) => filter(key, e.target.value)}
            />
          </label>
        ))}
      </form>
      <p role="status" className="text-xs text-muted-foreground">
        {busy
          ? "Loading usage…"
          : `${summary.calls ?? 0} requests in this range`}
      </p>
      {data && (
        <>
          {admin && data.alerts?.length > 0 && (
            <section className="card border-review">
              <h2 className="font-semibold">Usage warnings</h2>
              {data.alerts.map((a: Row, i: number) => (
                <p key={i} className="mt-2 text-sm">
                  <strong>
                    {a.tenant ?? "Platform"} · {a.provider}
                  </strong>
                  : {a.detail}
                </p>
              ))}
            </section>
          )}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              [
                admin ? "Actual platform cost" : "Your API charges",
                money(admin ? summary.provider_cost : summary.tenant_charge),
              ],
              ...(admin
                ? [
                    ["Tenant charges", money(summary.tenant_charge)],
                    ["API margin", money(summary.margin)],
                  ]
                : []),
              ["Platform requests", summary.platform_calls ?? 0],
              ["Tenant-owned requests", summary.tenant_calls ?? 0],
              ["Costs awaiting review", summary.awaiting_cost ?? 0],
              ["Failed requests", summary.failed ?? 0],
            ].map(([label, value]) => (
              <div className="card" key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-xl font-semibold break-words">
                  {value}
                </p>
              </div>
            ))}
          </div>
          {admin && data.leaders?.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {data.leaders.map((l: Row) => (
                <div className="card" key={l.label}>
                  <p className="text-xs text-muted-foreground">{l.label}</p>
                  <p className="mt-2 font-semibold">{l.name ?? "Unassigned"}</p>
                  <p className="text-sm">
                    {l.label === "Highest usage tenant"
                      ? `${l.value} requests`
                      : money(l.value)}
                  </p>
                </div>
              ))}
            </div>
          )}
          {admin &&
            filters.period === "month" &&
            !filters.from &&
            !filters.to && (
              <div className="card">
                <h2 className="font-semibold">Estimated monthly totals</h2>
                <p className="text-sm">
                  {Number(summary.awaiting_cost) > 0
                    ? "A reliable projection is not available while some provider costs are unknown."
                    : `At this month’s daily pace: ${money((Number(summary.provider_cost ?? 0) / new Date().getUTCDate()) * new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate())} platform cost and ${money((Number(summary.tenant_charge ?? 0) / new Date().getUTCDate()) * new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate())} tenant charges. This is a projection, not a bill.`}
                </p>
              </div>
            )}
          {Number(summary.awaiting_cost) > 0 && (
            <div className="card border-review">
              <strong>Some costs are not confirmed yet.</strong>
              <p className="mt-1 text-sm">
                Totals include confirmed amounts only. Unknown costs are not
                treated as free.{" "}
                {admin
                  ? "Review the provider’s billing records before approving charges."
                  : "Your charges may increase when the provider’s costs are confirmed."}
              </p>
            </div>
          )}
          {admin && (
            <p className="text-xs text-muted-foreground">
              Tenant charges use 1.25 × confirmed platform cost. This
              calculation and underlying costs are visible only to
              administrators. Usage before tracking was installed is not
              reconstructed.
            </p>
          )}
          {admin && data.issues?.length > 0 && (
            <section className="card border-review">
              <h2 className="font-semibold">Needs attention</h2>
              {data.issues.map((r: Row, i: number) => (
                <p key={i} className="mt-2 text-sm">
                  {r.provider}: {r.detail} ({r.calls}).{" "}
                  <button
                    className="underline"
                    onClick={() => filter("provider", r.provider)}
                  >
                    View usage
                  </button>
                </p>
              ))}
            </section>
          )}
          {!admin && (
            <section className="space-y-3">
              <h2 className="font-semibold">Your connected API services</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {data.providers?.map((p: Row) => (
                  <ProviderSetting
                    key={p.key}
                    provider={p}
                    save={save}
                    busy={busy}
                  />
                ))}
              </div>
              <Link href="/settings/integrations" className="text-sm underline">
                Manage text messaging and other connected services
              </Link>
            </section>
          )}
          <section className="card">
            <h2 className="font-semibold">Usage by account and provider</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[
                      "Account",
                      "Provider",
                      "Requests",
                      ...(admin ? ["Your cost"] : []),
                      "Tenant charge",
                    ].map((v) => (
                      <th className="p-2" key={v}>
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((r: Row, i: number) => (
                    <tr className="border-t" key={i}>
                      <td className="p-2">
                        {admin ? (
                          <button
                            className="underline"
                            onClick={() => filter("tenant", r.org_id)}
                          >
                            {r.tenant ?? "Unassigned"}
                          </button>
                        ) : (
                          r.tenant
                        )}
                      </td>
                      <td className="p-2">{r.provider}</td>
                      <td className="p-2">{r.calls}</td>
                      {admin && (
                        <td className="p-2">{money(r.provider_cost)}</td>
                      )}
                      <td className="p-2">{money(r.tenant_charge)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2 className="font-semibold">Recent activity</h2>
            {!data.rows.length ? (
              <p className="mt-3 text-sm">No usage matches these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "Time",
                        "Account / action",
                        "API source",
                        ...(admin ? ["Your cost"] : []),
                        "Tenant charge",
                        "Result / billing",
                        "Details",
                      ].map((v) => (
                        <th className="p-2" key={v}>
                          {v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r: Row) => (
                      <tr className="border-t" key={r.id}>
                        <td className="p-2 whitespace-nowrap">
                          {new Date(r.started_at).toLocaleString("en-US", {
                            timeZone: "UTC",
                          })}
                        </td>
                        <td className="p-2 min-w-40">
                          {r.tenant}
                          <br />
                          <strong>{r.feature}</strong>
                          <br />
                          {r.provider} · {r.service}
                        </td>
                        <td className="p-2">
                          {r.credential_source === "platform"
                            ? "Platform API"
                            : "Tenant API"}
                        </td>
                        {admin && (
                          <td className="p-2">{money(r.provider_cost)}</td>
                        )}
                        <td className="p-2">
                          {r.credential_source === "tenant"
                            ? "Pay provider directly"
                            : r.tenant_charge == null
                              ? "Awaiting cost"
                              : money(r.tenant_charge)}
                        </td>
                        <td className="p-2">
                          {r.outcome}
                          <br />
                          {r.billing_status.replace("_", " ")}
                        </td>
                        <td className="p-2">
                          <button
                            className="underline"
                            onClick={() => setSelected(r)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex items-center gap-4">
              <button
                className={field}
                disabled={data.page <= 1 || busy}
                onClick={() => filter("page", String(data.page - 1))}
              >
                Previous
              </button>
              <span>Page {data.page}</span>
              <button
                className={field}
                disabled={data.page * 50 >= summary.calls || busy}
                onClick={() => filter("page", String(data.page + 1))}
              >
                Next
              </button>
            </div>
          </section>
          {data.daily.length > 0 && (
            <section className="card">
              <h2 className="font-semibold">Usage over time</h2>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="p-2">Day</th>
                      <th className="p-2">Requests</th>
                      {admin && <th className="p-2">Platform cost</th>}
                      <th className="p-2">Tenant charges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((r: Row) => (
                      <tr className="border-t" key={r.day}>
                        <td className="p-2">{r.day}</td>
                        <td className="p-2">{r.calls}</td>
                        {admin && (
                          <td className="p-2">{money(r.provider_cost)}</td>
                        )}
                        <td className="p-2">{money(r.tenant_charge)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {admin && (
            <>
              <section className="card space-y-3">
                <h2 className="font-semibold">Compare provider billing</h2>
                <p className="text-sm">
                  Compare the total for your platform API account with this
                  ledger. This flags gaps without spreading unassigned costs
                  across tenants.
                </p>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save({
                      action: "report",
                      provider: f.get("provider"),
                      from: new Date(String(f.get("from"))).toISOString(),
                      to: new Date(
                        new Date(String(f.get("to"))).getTime() + 86400000,
                      ).toISOString(),
                      cost: f.get("cost"),
                      evidence: f.get("evidence"),
                    });
                  }}
                >
                  {[
                    ["provider", "Provider", "text"],
                    ["from", "First day", "date"],
                    ["to", "Last day", "date"],
                    ["cost", "Actual provider total in USD", "text"],
                    [
                      "evidence",
                      "Provider report or invoice reference",
                      "text",
                    ],
                  ].map(([name, label, type]) => (
                    <label className="text-sm" key={name}>
                      {label}
                      <input
                        name={name}
                        type={type}
                        required
                        className={`${field} w-full`}
                      />
                    </label>
                  ))}
                  <button className={field} disabled={busy}>
                    Compare totals
                  </button>
                </form>
                {data.reports?.map((r: Row) => (
                  <p key={r.id} className="border-t pt-2 text-sm">
                    {r.provider}: provider reported {money(r.reported_cost)};
                    ledger confirmed {money(r.tracked_cost)}. {r.unknown_calls}{" "}
                    requests awaiting cost.{" "}
                    {Number(r.reported_cost) !== Number(r.tracked_cost)
                      ? "There is a difference to investigate."
                      : "Totals match."}
                  </p>
                ))}
              </section>
              <section className="card space-y-3">
                <h2 className="font-semibold">Prepare a usage invoice</h2>
                <p className="text-sm">
                  Combine confirmed unbilled charges into one Stripe draft.
                  Fractions of a cent carry forward. Review and finalize the
                  draft in Stripe to collect payment.
                </p>
                <form
                  className="flex flex-wrap gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({
                      action: "invoice",
                      orgId: new FormData(e.currentTarget).get("orgId"),
                    });
                  }}
                >
                  <select
                    aria-label="Tenant to invoice"
                    name="orgId"
                    required
                    className={field}
                  >
                    <option value="">Choose a tenant</option>
                    {data.tenants.map((t: Row) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button className={field} disabled={busy}>
                    Create draft invoice
                  </button>
                </form>
              </section>
              <section className="card space-y-3">
                <h2 className="font-semibold">
                  Provider prices and spending reservations
                </h2>
                <p className="text-sm">
                  Record current provider prices for estimates. Set a
                  conservative maximum cost per request for spending limits.
                  Provider-confirmed costs still determine bills. Keep these
                  prices current when a provider changes its rates.
                </p>
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save({
                      action: "rate",
                      provider: f.get("provider"),
                      service: f.get("service"),
                      maxCost: f.get("maxCost") || null,
                      evidence: f.get("evidence"),
                      rates: Object.fromEntries(
                        [
                          "requests",
                          "input_tokens",
                          "output_tokens",
                          "cache_read_input_tokens",
                          "cache_creation_input_tokens",
                        ]
                          .map((k) => [k, f.get(k)])
                          .filter(([, v]) => v),
                      ),
                    });
                  }}
                >
                  {[
                    ["provider", "Provider"],
                    ["service", "Exact model or service name"],
                    ["maxCost", "Maximum USD per request"],
                    ["evidence", "Price source or billing reference"],
                    ["requests", "USD per million requests"],
                    ["input_tokens", "USD per million input tokens"],
                    ["output_tokens", "USD per million output tokens"],
                    [
                      "cache_read_input_tokens",
                      "USD per million cached input tokens",
                    ],
                    [
                      "cache_creation_input_tokens",
                      "USD per million cache write tokens",
                    ],
                  ].map(([name, label]) => (
                    <label className="text-sm" key={name}>
                      {label}
                      <input
                        name={name}
                        required={["provider", "service", "evidence"].includes(
                          name,
                        )}
                        className={`${field} w-full`}
                      />
                    </label>
                  ))}
                  <button className={field} disabled={busy}>
                    Save provider price
                  </button>
                </form>
              </section>
              {data.rates?.length>0&&<section className="card"><h2 className="font-semibold">Saved provider prices</h2>{data.rates.map((r:Row)=><p className="mt-2 text-sm" key={r.provider+r.service}>{r.provider} · {r.service}: maximum request cost {money(r.max_request_cost)}. Source: {r.evidence}.</p>)}</section>}
            </>
          )}
        </>
      )}
      {selected && (
        <dialog
          ref={dialogRef}
          aria-label="Usage details"
          className="w-[calc(100%-2rem)] max-w-xl rounded-xl p-0 backdrop:bg-black/50"
          onCancel={() => setSelected(null)}
        >
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <button
              autoFocus
              className="float-right underline"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
            <h2 className="text-lg font-semibold">{selected.feature}</h2>
            {error && (
              <p role="alert" className="mt-3 text-risk">
                {error}
              </p>
            )}
            <p className="mt-2 text-sm">
              {selected.tenant} used {selected.provider} ({selected.service}).
            </p>
            <dl className="my-4 grid grid-cols-2 gap-2 text-sm">
              {Object.entries({
                Source: selected.credential_source,
                Result: selected.outcome,
                Billing: selected.billing_status,
                "Tenant charge": money(selected.tenant_charge),
                ...(admin
                  ? {
                      "Actual cost": money(selected.provider_cost),
                      "Estimated cost": money(selected.estimated_cost),
                      "Provider request": selected.provider_request_id,
                      "Cost evidence": selected.evidence,
                    }
                  : {}),
                Workflow: selected.workflow,
                "Related record": selected.related_id,
              }).map(([k, v]) => (
                <div className="break-words" key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{String(v ?? "Not recorded")}</dd>
                </div>
              ))}
            </dl>
            <h3 className="font-semibold">Units used</h3>
            {Object.entries(selected.usage ?? {}).map(([k, v]) => (
              <p className="text-sm" key={k}>
                {k.replaceAll("_", " ")}: {String(v)}
              </p>
            ))}
            {selected.error_code && (
              <p role="alert" className="mt-3 text-risk">
                {selected.error_code}
              </p>
            )}
            {admin && (
              <>
                <form
                  className="mt-5 space-y-3 border-t pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save({
                      action: "reconcile",
                      id: selected.id,
                      cost: f.get("cost"),
                      evidence: f.get("evidence"),
                    });
                  }}
                >
                  <h3 className="font-semibold">Confirm provider cost</h3>
                  <label className="block text-sm">
                    Actual cost in USD
                    <input
                      name="cost"
                      required
                      inputMode="decimal"
                      className={`${field} mt-1 w-full`}
                      defaultValue={selected.provider_cost ?? ""}
                    />
                  </label>
                  <label className="block text-sm">
                    Provider invoice or billing evidence
                    <input
                      name="evidence"
                      minLength={5}
                      required
                      className={`${field} mt-1 w-full`}
                    />
                  </label>
                  <button disabled={busy} className={field}>
                    Save confirmed cost
                  </button>
                </form>
                <form
                  className="mt-5 space-y-3 border-t pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save({
                      action: "status",
                      id: selected.id,
                      status: f.get("status"),
                      reference: f.get("reference"),
                    });
                  }}
                >
                  <h3 className="font-semibold">Record a billing update</h3>
                  <p className="text-xs">
                    Use this after the invoice, payment, credit, or refund
                    exists. This button does not collect money.
                  </p>
                  <select name="status" className={field}>
                    {["billed", "paid", "credited", "refunded"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    name="reference"
                    required
                    minLength={3}
                    placeholder="Invoice or payment reference"
                    aria-label="Invoice or payment reference"
                    className={`${field} w-full`}
                  />
                  <button className={field} disabled={busy}>
                    Save billing status
                  </button>
                </form>
              </>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
function ProviderSetting({
  provider: p,
  save,
  busy,
}: {
  provider: Row;
  save: (v: Row) => Promise<void>;
  busy: boolean;
}) {
  const [source, setSource] = useState(""),
    [secret, setSecret] = useState("");
  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void save({
          key: p.key,
          source,
          secret,
          values: Object.fromEntries(
            (p.extraFields ?? []).map((f: Row) => [f.key, form.get(f.key)]),
          ),
          acceptCharges: source === "platform",
        }).then(() => setSecret(""));
      }}
    >
      <h3 className="font-semibold">{p.provider}</h3>{p.error&&<p role="alert" className="text-sm text-risk">{p.error}</p>}
      <p className="text-sm">
        Active:{" "}
        {p.active === "platform"
          ? "Our API"
          : p.active === "tenant"
            ? "Your API"
            : "Not connected"}
      </p>
      <select
        aria-label={`${p.provider} API source`}
        className={`${field} w-full`}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        required
      >
        <option value="">Choose an option</option>
        <option value="platform" disabled={!p.platformAvailable}>
          Use Our API
        </option>
        <option value="tenant">Use My Own API</option>
      </select>
      {source === "platform" && (
        <>
          <p className="text-sm">
            You’re using our connected API service. Any API usage generated by
            your account will be added to your bill.
          </p>
          <label className="flex gap-2 text-sm">
            <input required type="checkbox" />I agree to pay the API usage
            charges generated by my account.
          </label>
        </>
      )}
      {source === "tenant" && (
        <>
          <p className="text-sm">
            Use your own API account and pay the provider directly for your
            usage. We won’t switch to our paid API if your key stops working.
          </p>
          <input
            aria-label={`${p.provider} API key`}
            type="password"
            autoComplete="new-password"
            className={`${field} w-full`}
            required
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste your API key"
          />
          {(p.extraFields ?? []).map((f: Row) => (
            <label className="block text-sm" key={f.key}>
              {f.label}
              <input
                name={f.key}
                type="password"
                autoComplete="new-password"
                required
                className={`${field} w-full`}
              />
            </label>
          ))}
        </>
      )}
      <button className={field} disabled={!source || busy}>
        {source === "tenant" ? "Validate and connect" : "Save choice"}
      </button>
    </form>
  );
}
function LimitSettings({
  data,
  save,
  busy,
}: {
  data: Row;
  save: (v: Row) => Promise<void>;
  busy: boolean;
}) {
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">API safeguards</h2>
      <p className="text-sm">
        Pause a service, require tenant-owned credentials, or set a hard dollar
        limit. Each request reserves its configured maximum cost before it runs.
        Requests without a price ceiling are blocked when a dollar limit is
        set. Daily request limits work without pricing and reset at midnight UTC. A platform-wide request limit covers all tenants sharing your API credentials.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({
            action: "limit",
            orgId: f.get("orgId") || null,
            provider: f.get("provider") || "*",
            feature: f.get("feature") || "*",
            amount: f.get("amount") || null,
            warning: Number(f.get("warning")),
            paused: f.get("paused") === "on",
            requireTenant: f.get("requireTenant") === "on",
            dailyRequests: f.get("dailyRequests") === "" ? null : Number(f.get("dailyRequests")),
          });
        }}
      >
        <label className="text-sm">
          Account
          <select name="orgId" className={`${field} w-full`}>
            <option value="">Entire platform</option>
            {data.tenants.map((t: Row) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Provider
          <select name="provider" className={`${field} w-full`}>
            <option value="*">All providers</option>
            {["Anthropic", "Google Maps", "Hunter", "Ahrefs", "Twilio"].map(
              (p) => (
                <option key={p}>{p}</option>
              ),
            )}
          </select>
        </label>
        <label className="text-sm">
          Feature (blank means all)
          <input name="feature" className={`${field} w-full`} />
        </label>
        <label className="text-sm">
          Monthly dollar limit (blank means no cap)
          <input
            name="amount"
            inputMode="decimal"
            className={`${field} w-full`}
          />
        </label>
        <label className="text-sm">
          Maximum platform-key requests per day (blank means no cap)
          <input name="dailyRequests" type="number" min="0" max="1000000" step="1" className={`${field} w-full`} />
        </label>
        <label className="text-sm">
          Warning at percent
          <input
            name="warning"
            type="number"
            min="1"
            max="100"
            defaultValue="80"
            className={`${field} w-full`}
          />
        </label>
        <div className="space-y-2">
          <label className="flex gap-2 text-sm">
            <input name="paused" type="checkbox" />
            Pause API use
          </label>
          <label className="flex gap-2 text-sm">
            <input name="requireTenant" type="checkbox" />
            Require the tenant’s own API
          </label>
        </div>
        <button className={field} disabled={busy}>
          Save safeguard
        </button>
      </form>
      {data.limits.map((l: Row) => (
        <div key={l.id} className="border-t pt-2 text-sm">
          <strong>{l.tenant ?? "Entire platform"}</strong>: {l.provider} /{" "}
          {l.feature}. Limit:{" "}
          {l.monthly_limit == null ? "No cap" : money(l.monthly_limit)}.{" "}
          {l.daily_requests != null ? `Daily platform-key requests: ${l.daily_requests}. ` : ""}
          {l.paused ? "Paused. " : ""}
          {l.require_tenant_key ? "Tenant API required." : ""}
          <button
            className="ml-2 underline"
            onClick={() =>
              void save({
                action: "limit",
                orgId: l.org_id,
                provider: l.provider,
                feature: l.feature,
                amount: null,
                warning: l.warning_percent,
                paused: false,
                requireTenant: false,
              })
            }
          >
            Remove restrictions
          </button>
        </div>
      ))}
    </section>
  );
}
