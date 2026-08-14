"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlatformKeyState } from "@/lib/admin/platform-keys";

/**
 * Lending our own API credentials to one customer.
 *
 * The screen is built around the question an admin actually arrives with,
 * which is not "can I turn this on" but "whose spend is on our key, and can I
 * stop it". So each credential states what it is doing today before it offers
 * to change anything: their own key, our key on a grant, our key on a trial
 * allowance, or nothing at all.
 *
 * Expiry is a first-class field rather than an advanced option. A grant given
 * for a demo that nobody remembers to revoke is how a courtesy becomes a
 * permanent bill, so the form defaults to a date and asks for an explicit
 * choice to remove it.
 */
export function PlatformKeyGrants({
  orgId,
  orgName,
  states,
  isTrial,
}: {
  orgId: string;
  orgName: string;
  states: PlatformKeyState[];
  /** Trials borrow two keys automatically, which changes what "no grant" means. */
  isTrial: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());

  async function run(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/accounts/${orgId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? "That did not work." });
        return;
      }
      setNote({ ok: true, text: data.message ?? "Done." });
      setOpen(null);
      setReason("");
      setExpiresAt(defaultExpiry());
      router.refresh();
    } catch {
      setNote({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Our API keys on this account</h2>
      <p className="text-sm text-muted-foreground">
        Customers bring their own credentials. Lending ours puts {orgName}&rsquo;s usage on
        our bill until somebody takes it back, so every grant is attributed and shows up in
        this account&rsquo;s admin history.
      </p>

      {note && (
        <p
          className={`rounded-md border px-4 py-3 text-sm ${
            note.ok
              ? "border-pursue/40 bg-pursue/5 text-pursue"
              : "border-risk/40 bg-risk/5 text-risk"
          }`}
        >
          {note.text}
        </p>
      )}

      <ul className="divide-y divide-border/60 rounded-lg border border-border">
        {states.map((s) => {
          const active = Boolean(s.grantedAt) && !s.expired;
          const trialBorrowing = !active && isTrial && s.lendableDuringTrial && !s.hasOwnKey;
          return (
            <li key={s.key} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="font-medium">{s.label}</span>
                  <span className="pl-2 text-xs text-muted-foreground">{s.powers}</span>
                </div>
                <Status
                  hasOwnKey={s.hasOwnKey}
                  active={active}
                  expired={s.expired}
                  trialBorrowing={trialBorrowing}
                />
              </div>

              <p className="text-sm text-muted-foreground">
                {s.hasOwnKey
                  ? "They pay for this themselves. A grant would change nothing while their own key is set, because their key always wins."
                  : active
                    ? `On our key since ${date(s.grantedAt)}${
                        s.expiresAt ? `, until ${date(s.expiresAt)}` : ", with no expiry"
                      }${s.grantedByEmail ? `, granted by ${s.grantedByEmail}` : ""}.`
                    : s.expired
                      ? `The grant from ${date(s.grantedAt)} expired on ${date(
                          s.expiresAt
                        )} and is doing nothing. Remove it to tidy up, or lend it again.`
                      : trialBorrowing
                        ? `Borrowed automatically while the trial runs, up to ${s.trialBudget} calls. A grant would carry on past the trial.`
                        : "Not set. This integration is switched off for them."}
              </p>

              {s.note && active && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Reason given: </span>
                  {s.note}
                </p>
              )}

              {s.calls > 0 && (
                <p className="text-xs text-muted-foreground">
                  {s.calls.toLocaleString("en-US")} call
                  {s.calls === 1 ? "" : "s"} made on our credential so far
                  {s.trialBudget > 0 ? ` (trial allowance ${s.trialBudget})` : ""}.
                </p>
              )}

              {!s.platformHasKey && (
                <p className="text-xs text-risk">
                  We hold no {s.label} key ourselves, so there is nothing to lend.
                </p>
              )}

              {active || s.expired ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy !== null}
                  onClick={() => run(s.key, { action: "revoke_key", envKey: s.key })}
                >
                  {busy === s.key
                    ? "Working…"
                    : s.expired
                      ? "Remove the expired grant"
                      : "Take our key back"}
                </button>
              ) : open === s.key ? (
                <div className="space-y-2 rounded-md border border-border bg-surface/50 p-3">
                  {s.hazard && (
                    <p className="rounded-md border border-risk/40 bg-risk/5 px-3 py-2 text-sm text-risk">
                      {s.hazard}
                    </p>
                  )}
                  <input
                    className="input w-full"
                    placeholder="Why does this account need our key?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm text-muted-foreground" htmlFor={`exp-${s.key}`}>
                      Ends
                    </label>
                    <input
                      id={`exp-${s.key}`}
                      type="date"
                      className="input"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-sm text-accent-strong hover:underline"
                      onClick={() => setExpiresAt("")}
                    >
                      No expiry
                    </button>
                  </div>
                  {!expiresAt && (
                    <p className="text-sm text-muted-foreground">
                      This will run until somebody revokes it by hand.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy !== null || !reason.trim() || !s.platformHasKey}
                      onClick={() =>
                        run(s.key, {
                          action: "grant_key",
                          envKey: s.key,
                          reason,
                          expiresAt: expiresAt || null,
                        })
                      }
                    >
                      {busy === s.key ? "Working…" : `Lend our ${s.label} key`}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy !== null}
                      onClick={() => setOpen(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy !== null || !s.platformHasKey}
                  onClick={() => {
                    setOpen(s.key);
                    setReason("");
                    setExpiresAt(defaultExpiry());
                  }}
                >
                  Lend our key
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Status({
  hasOwnKey,
  active,
  expired,
  trialBorrowing,
}: {
  hasOwnKey: boolean;
  active: boolean;
  expired: boolean;
  trialBorrowing: boolean;
}) {
  const [text, tone] = hasOwnKey
    ? ["Their own key", "text-muted-foreground"]
    : active
      ? ["On our key", "text-risk"]
      : trialBorrowing
        ? ["Trial allowance", "text-accent-strong"]
        : expired
          ? ["Grant expired", "text-muted-foreground"]
          : ["Not set", "text-muted-foreground"];
  return <span className={`text-xs uppercase tracking-wide ${tone}`}>{text}</span>;
}

function date(value: string | null): string {
  if (!value) return "an unknown date";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "an unknown date"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Two weeks out, so the common case is a grant that ends on its own. */
function defaultExpiry(): string {
  const d = new Date(Date.now() + 14 * 86_400_000);
  return d.toISOString().slice(0, 10);
}
