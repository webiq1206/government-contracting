"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";
import { NOTIFY_EVENTS, STATUS_LABEL, syncLine, type ServiceDefinition, type ServiceProvider, type ServiceStatus } from "@/lib/domain/connected-services";

type Provider = ServiceDefinition & { available: boolean };
type Connection = {
  id: string;
  provider: ServiceProvider;
  personal: boolean;
  mine: boolean;
  status: ServiceStatus;
  account_label: string | null;
  settings: Record<string, unknown>;
  last_error: string | null;
  last_synced_at: string | null;
};
type Webhook = { id: string; label: string; url: string; events: string[]; active: boolean; last_status: string | null; last_delivered_at: string | null; failure_count: number };
type Data = { providers: Provider[]; connections: Connection[]; webhooks: Webhook[]; canManageIntegrations: boolean; userId: string };

const GROUPS: { kind: ServiceDefinition["kind"]; title: string; blurb: string }[] = [
  { kind: "calendar", title: "Calendars", blurb: "Bid deadlines on the calendar you already look at, kept current." },
  { kind: "files", title: "File storage", blurb: "Save bid packages and solicitation documents where your team keeps files." },
  { kind: "notifications", title: "Team channels", blurb: "The updates you choose, in the channel your team already reads." },
];

async function readJson(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
}

/**
 * Connect, manage, and disconnect the apps a company already uses.
 *
 * Every card says what connecting lets a person do and what is read and
 * written, in plain words, before the button. A provider the platform has
 * not registered shows exactly that, never a button that fails.
 */
export function ConnectedApps({ notice }: { notice: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(notice);

  async function load() {
    try {
      const res = await fetch("/api/services", { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Data);
      setLoadError(null);
    } catch {
      setLoadError("Your connected apps could not be loaded. Reload to try again; nothing was changed.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-risk">{loadError}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading connected apps</p>;

  return (
    <div className="space-y-6">
      {flash && (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-sm">
          {flash}{" "}
          <button type="button" className="underline" onClick={() => setFlash(null)}>Dismiss</button>
        </p>
      )}
      {GROUPS.map((g) => (
        <section key={g.kind} className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{g.title}</h2>
            <p className="text-sm text-muted-foreground">{g.blurb}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.providers
              .filter((p) => p.kind === g.kind)
              .map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  connections={data.connections.filter((c) => c.provider === p.id)}
                  canManage={data.canManageIntegrations}
                  onChanged={() => {
                    void load();
                    router.refresh();
                  }}
                />
              ))}
          </div>
        </section>
      ))}
      <WebhooksSection webhooks={data.webhooks} canManage={data.canManageIntegrations} onChanged={() => void load()} />
    </div>
  );
}

function ProviderCard({ provider: p, connections, canManage, onChanged }: { provider: Provider; connections: Connection[]; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Connection | null>(null);
  const [teamsUrl, setTeamsUrl] = useState("");
  const [calendars, setCalendars] = useState<Record<string, { id: string; name: string; primary: boolean }[]>>({});

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function test(c: Connection) {
    await act(async () => {
      const res = await fetch(`/api/services/connections/${c.id}/test`, { method: "POST", signal: AbortSignal.timeout(30_000) });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d.error ?? "The test failed.");
      setMsg(String(d.message ?? "Connected."));
      onChanged();
    });
  }
  async function patch(c: Connection, body: Record<string, unknown>, done: string) {
    await act(async () => {
      const res = await fetch(`/api/services/connections/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d.error ?? "That did not save.");
      setMsg(done);
      onChanged();
    });
  }
  async function disconnect(c: Connection) {
    await act(async () => {
      const res = await fetch(`/api/services/connections/${c.id}`, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d.error ?? "That did not disconnect.");
      setConfirm(null);
      setMsg(`${p.name} disconnected. Nothing already pushed was removed.`);
      onChanged();
    });
  }
  async function loadCalendars(c: Connection) {
    await act(async () => {
      const res = await fetch(`/api/services/connections/${c.id}/options`, { signal: AbortSignal.timeout(30_000) });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d.error ?? "Could not list calendars.");
      setCalendars((s) => ({ ...s, [c.id]: (d.calendars as { id: string; name: string; primary: boolean }[]) ?? [] }));
    });
  }
  async function connectTeams() {
    await act(async () => {
      const res = await fetch("/api/services/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: teamsUrl }), signal: AbortSignal.timeout(20_000) });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d.error ?? "That did not connect.");
      setTeamsUrl("");
      setMsg("Teams channel connected. Send a test message to confirm it lands.");
      onChanged();
    });
  }

  const company = connections.find((c) => !c.personal);
  const mine = connections.find((c) => c.personal && c.mine);

  return (
    <article className="card space-y-3" id={p.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{p.name}</h3>
        {connections.length > 0 ? (
          <span className={`badge ${connections.some((c) => c.status === "needs_attention") ? "bg-risk/15 text-risk" : connections.every((c) => c.status === "paused") ? "bg-review/15 text-review" : "bg-pursue-soft text-pursue-strong"}`}>
            {STATUS_LABEL[connections.some((c) => c.status === "needs_attention") ? "needs_attention" : connections.every((c) => c.status === "paused") ? "paused" : "connected"]}
          </span>
        ) : (
          <span className="badge bg-surface-raised text-muted-foreground">{p.available ? "Not connected" : "Not available yet"}</span>
        )}
      </div>
      <p className="text-sm">{p.lets}</p>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-accent">What it reads and writes</summary>
        <dl className="mt-1 space-y-1 text-xs text-muted-foreground">
          <div><dt className="inline font-medium text-foreground">Reads: </dt><dd className="inline">{p.reads}</dd></div>
          <div><dt className="inline font-medium text-foreground">Writes: </dt><dd className="inline">{p.writes}</dd></div>
          <div><dt className="inline font-medium text-foreground">Direction: </dt><dd className="inline">{p.direction}</dd></div>
        </dl>
      </details>

      {connections.map((c) => (
        <div key={c.id} className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">
            {c.account_label ?? p.name}{" "}
            <span className="font-normal text-muted-foreground">{c.personal ? (c.mine ? "(your personal connection)" : "(a teammate's)") : "(company-wide)"}</span>
          </p>
          <p className={`mt-1 text-xs ${c.status === "needs_attention" ? "text-risk" : "text-muted-foreground"}`}>{syncLine(c)}</p>

          {(p.kind === "calendar") && (c.mine || (!c.personal && canManage)) && (
            <div className="mt-2 space-y-1">
              <label className="label" htmlFor={`cal-${c.id}`}>Calendar to write to</label>
              {calendars[c.id] ? (
                <select
                  id={`cal-${c.id}`}
                  className="select w-full"
                  value={(c.settings.calendar_id as string) ?? "primary"}
                  onChange={(e) => void patch(c, { calendar_id: e.target.value }, "Calendar saved. Deadlines move there on the next sync.")}
                >
                  <option value="primary">Primary calendar</option>
                  {calendars[c.id].map((cal) => (
                    <option key={cal.id} value={cal.id}>{cal.name}{cal.primary ? " (primary)" : ""}</option>
                  ))}
                </select>
              ) : (
                <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => void loadCalendars(c)}>
                  {typeof c.settings.calendar_id === "string" && c.settings.calendar_id !== "primary" ? "Change calendar" : "Choose a calendar (primary until you do)"}
                </button>
              )}
            </div>
          )}

          {p.kind === "notifications" && (!c.personal && canManage) && (
            <fieldset className="mt-2">
              <legend className="label">Send to this channel</legend>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {NOTIFY_EVENTS.map((e) => {
                  const on = Array.isArray(c.settings.events) && (c.settings.events as string[]).includes(e.key);
                  return (
                    <label key={e.key} className="flex min-h-11 items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        disabled={busy}
                        onChange={() => {
                          const current = Array.isArray(c.settings.events) ? (c.settings.events as string[]) : [];
                          void patch(c, { events: on ? current.filter((k) => k !== e.key) : [...current, e.key] }, "Saved.");
                        }}
                      />
                      <span>
                        {e.label}
                        <span className="block text-xs text-muted-foreground">{e.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {(c.mine || (!c.personal && canManage)) && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => void test(c)}>Test</button>
              {c.status === "paused" ? (
                <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => void patch(c, { paused: false }, "Resumed.")}>Resume</button>
              ) : (
                <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => void patch(c, { paused: true }, "Paused. Nothing is sent until you resume.")}>Pause</button>
              )}
              {p.method === "oauth" && (
                <a className="btn-ghost inline-flex min-h-11 items-center text-xs" href={`/api/services/${p.id}/connect?scope=${c.personal ? "personal" : "company"}`}>Reconnect</a>
              )}
              <button type="button" className="btn-ghost min-h-11 text-xs text-risk" disabled={busy} onClick={() => setConfirm(c)}>Disconnect</button>
            </div>
          )}
        </div>
      ))}

      {p.available && p.method === "oauth" && (
        <div className="flex flex-wrap gap-2">
          {p.scopes.includes("personal") && !mine && (
            <a className="btn-primary inline-flex min-h-11 items-center" href={`/api/services/${p.id}/connect?scope=personal`}>Connect my {p.name.split(" (")[0]}</a>
          )}
          {p.scopes.includes("company") && !company && canManage && (
            <a className={`${p.scopes.includes("personal") ? "btn-ghost" : "btn-primary"} inline-flex min-h-11 items-center`} href={`/api/services/${p.id}/connect?scope=company`}>
              Connect for the company
            </a>
          )}
          {!canManage && !p.scopes.includes("personal") && !company && (
            <p className="text-xs text-muted-foreground">An administrator connects this for the company.</p>
          )}
        </div>
      )}
      {p.available && p.method === "webhook_url" && !company && canManage && (
        <div className="space-y-2">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            {(p.setupSteps ?? []).map((s) => <li key={s}>{s}</li>)}
          </ol>
          <div className="search-row">
            <label className="sr-only" htmlFor={`url-${p.id}`}>Workflow link</label>
            <input id={`url-${p.id}`} className="input" type="url" placeholder="https://..." value={teamsUrl} onChange={(e) => setTeamsUrl(e.target.value)} />
            <button type="button" className="btn-primary min-h-11 shrink-0" disabled={busy || !teamsUrl.trim()} onClick={() => void connectTeams()}>Connect</button>
          </div>
        </div>
      )}
      {!p.available && <p className="text-xs text-muted-foreground">{p.unavailableNote}</p>}

      {msg && <p role="status" className="text-sm text-pursue-strong">{msg}</p>}
      {err && <p role="alert" className="text-sm text-risk">{err}</p>}

      <ConfirmDialog
        open={confirm != null}
        title={`Disconnect ${p.name}?`}
        confirmLabel="Disconnect"
        busy={busy}
        onConfirm={() => confirm && void disconnect(confirm)}
        onCancel={() => setConfirm(null)}
        body={
          <p className="text-left text-sm">
            Brost Co stops reading and sending through this connection right away. Events already on the calendar, files already saved and messages already posted stay where they are; nothing is deleted. You can connect again any time.
          </p>
        }
      />
    </article>
  );
}

function WebhooksSection({ webhooks, canManage, onChanged }: { webhooks: Webhook[]; canManage: boolean; onChanged: () => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["opportunity", "bid", "reply"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [remove, setRemove] = useState<Webhook | null>(null);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message || "That did not work.");
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    await act(async () => {
      const res = await fetch("/api/services/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, url, events }), signal: AbortSignal.timeout(20_000) });
      const d = await readJson(res);
      if (!res.ok) throw new Error(d.error ?? "That did not save.");
      setSecret(String(d.secret));
      setLabel("");
      setUrl("");
      onChanged();
    });
  }
  async function test(w: Webhook) {
    await act(async () => {
      const res = await fetch(`/api/services/webhooks/${w.id}/test`, { method: "POST", signal: AbortSignal.timeout(30_000) });
      const d = await readJson(res);
      setMsg(String(d.message ?? (res.ok ? "Delivered." : d.error ?? "The test failed.")));
      onChanged();
    });
  }
  async function toggle(w: Webhook) {
    await act(async () => {
      const res = await fetch(`/api/services/webhooks/${w.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !w.active }), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error("That did not save.");
      onChanged();
    });
  }
  async function del(w: Webhook) {
    await act(async () => {
      const res = await fetch(`/api/services/webhooks/${w.id}`, { method: "DELETE", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error("That did not delete.");
      setRemove(null);
      onChanged();
    });
  }

  return (
    <section className="space-y-3" id="webhooks">
      <div>
        <h2 className="font-display text-lg font-semibold">Zapier, Make and webhooks</h2>
        <p className="text-sm text-muted-foreground">
          Send the events you choose to any system that takes a web address: a Zapier or Make trigger, or your own. Each message is signed so the receiver can check it came from Brost Co.
        </p>
      </div>
      {webhooks.length > 0 && (
        <ul className="space-y-2">
          {webhooks.map((w) => (
            <li key={w.id} className="card space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{w.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{w.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.events.map((e) => NOTIFY_EVENTS.find((n) => n.key === e)?.label ?? e).join(", ") || "No events chosen"}
                    {" · "}
                    {!w.active ? "Off" : w.failure_count > 0 ? `Last delivery failed (${w.failure_count} in a row)` : w.last_delivered_at ? `Last delivered ${new Date(w.last_delivered_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Nothing sent yet"}
                  </p>
                </div>
                <span className={`badge ${!w.active ? "bg-surface-raised text-muted-foreground" : w.failure_count > 0 ? "bg-risk/15 text-risk" : "bg-pursue-soft text-pursue-strong"}`}>
                  {!w.active ? "Off" : w.failure_count > 0 ? "Needs attention" : "On"}
                </span>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => void test(w)}>Send test</button>
                  <button type="button" className="btn-ghost min-h-11 text-xs" disabled={busy} onClick={() => void toggle(w)}>{w.active ? "Turn off" : "Turn on"}</button>
                  <button type="button" className="btn-ghost min-h-11 text-xs text-risk" disabled={busy} onClick={() => setRemove(w)}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {secret && (
        <div role="status" className="rounded-md border border-review/40 bg-review/10 p-3 text-sm">
          <p className="font-medium">Signing secret (shown once)</p>
          <code className="mt-1 block break-all text-xs">{secret}</code>
          <p className="mt-1 text-xs text-muted-foreground">
            Each request carries x-brostco-timestamp and x-brostco-signature: v1=HMAC-SHA256(secret, timestamp + "." + body). Zapier and Make can ignore it; your own receiver should check it.
          </p>
          <button type="button" className="mt-2 underline" onClick={() => setSecret(null)}>I have saved it</button>
        </div>
      )}
      {canManage && (
        <div className="card space-y-3">
          <p className="text-sm font-medium">Add a webhook</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="wh-label">Name</label>
              <input id="wh-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Zapier: new opportunities" />
            </div>
            <div>
              <label className="label" htmlFor="wh-url">Address (https)</label>
              <input id="wh-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/..." />
            </div>
          </div>
          <fieldset>
            <legend className="label">Events to send</legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {NOTIFY_EVENTS.map((e) => (
                <label key={e.key} className="flex min-h-11 items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={events.includes(e.key)} onChange={() => setEvents(events.includes(e.key) ? events.filter((k) => k !== e.key) : [...events, e.key])} />
                  <span>{e.label}<span className="block text-xs text-muted-foreground">{e.hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="button" className="btn-primary min-h-11" disabled={busy || !url.trim() || events.length === 0} onClick={() => void create()}>Add webhook</button>
        </div>
      )}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {err && <p role="alert" className="text-sm text-risk">{err}</p>}
      <ConfirmDialog
        open={remove != null}
        title="Remove this webhook?"
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => remove && void del(remove)}
        onCancel={() => setRemove(null)}
        body={<p className="text-left text-sm">Nothing more is sent to it. Anything the receiver already has stays with the receiver.</p>}
      />
    </section>
  );
}
