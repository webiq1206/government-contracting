"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deletionView,
  DELETION_GRACE_DAYS,
  RETENTION_EXPLANATION,
} from "@/lib/domain/account-deletion";

/**
 * The dangerous half of the account detail page.
 *
 * Every action posts, shows what came back, and refreshes. Nothing is
 * optimistic: these change somebody else's billing or delete their data, and
 * showing success before the server agreed is how an admin walks away
 * believing a comp was applied when it was not.
 */
export function AccountActions({
  orgId,
  orgName,
  billingExempt,
  suspended,
  deletionScheduledAt,
  deletionRequestedBy,
  deletionReason,
  canImpersonate,
  ownerEmail,
  currentDiscount,
}: {
  orgId: string;
  orgName: string;
  billingExempt: boolean;
  suspended: boolean;
  /** Set when a deletion is already scheduled, so the zone shows the countdown instead. */
  deletionScheduledAt: string | null;
  deletionRequestedBy: string | null;
  deletionReason: string | null;
  canImpersonate: boolean;
  ownerEmail: string | null;
  /** What they are on today, running at Stripe or still just promised. */
  currentDiscount: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [compReason, setCompReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const deletion = deletionView(deletionScheduledAt);
  const [days, setDays] = useState(14);
  const [confirmName, setConfirmName] = useState("");

  const [concessionKind, setConcessionKind] = useState<"percent" | "free_months">("percent");
  const [percent, setPercent] = useState(20);
  const [percentMonths, setPercentMonths] = useState("");
  const [freeMonths, setFreeMonths] = useState(3);
  const [concessionReason, setConcessionReason] = useState("");

  async function run(
    key: string,
    body: Record<string, unknown>,
    method: "POST" | "DELETE" = "POST"
  ) {
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/accounts/${orgId}`, {
        method,
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
      if (method === "DELETE") {
        window.location.href = "/admin/accounts";
        return;
      }
      router.refresh();
    } catch {
      setNote({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function impersonate() {
    setBusy("impersonate");
    setNote(null);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect?: string;
        error?: string;
      };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? "Could not start a support session." });
        setBusy(null);
        return;
      }
      // Full navigation: the session cookie now belongs to another account and
      // nothing rendered so far is still correct.
      window.location.href = data.redirect ?? "/today";
    } catch {
      setNote({ ok: false, text: "Could not reach the server." });
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
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

      <Card
        title="Billing exemption"
        body="A comped account has full access no matter what Stripe says, and is never metered. Used for our own organization and for anyone we have decided not to charge."
      >
        {billingExempt ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => run("uncomp", { action: "uncomp" })}
          >
            {busy === "uncomp" ? "Working…" : "Put back on normal billing"}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input flex-1"
              placeholder="Why is this account comped?"
              value={compReason}
              onChange={(e) => setCompReason(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null || !compReason.trim()}
              onClick={() => run("comp", { action: "comp", reason: compReason })}
            >
              {busy === "comp" ? "Working…" : "Comp this account"}
            </button>
          </div>
        )}
      </Card>

      <Card
        title="Discounts and free months"
        body={
          billingExempt
            ? "This account is comped, so it is not billed at all and a discount would do nothing. Put it back on normal billing first if it should start paying a reduced rate."
            : "Free months are a 100% discount that stops on its own, so billing resumes at the normal rate without anyone remembering to change it back. A discount applies to the next invoice if they already subscribe, or automatically at checkout if they have not yet."
        }
      >
        {currentDiscount ? (
          <div className="space-y-3">
            <p className="text-sm">
              Currently on <strong>{currentDiscount}</strong>.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() =>
                run("remove_discount", {
                  action: "remove_discount",
                  reason: concessionReason,
                })
              }
            >
              {busy === "remove_discount" ? "Working…" : "Back to the normal rate"}
            </button>
          </div>
        ) : billingExempt ? null : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-44"
                value={concessionKind}
                onChange={(e) =>
                  setConcessionKind(e.target.value as "percent" | "free_months")
                }
              >
                <option value="percent">A percentage off</option>
                <option value="free_months">Free months</option>
              </select>
              {concessionKind === "percent" ? (
                <>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="input w-20"
                    value={percent}
                    onChange={(e) => setPercent(Number(e.target.value))}
                    aria-label="Percentage off"
                  />
                  <span className="text-sm text-muted-foreground">% off for</span>
                  <input
                    type="number"
                    min={1}
                    max={36}
                    className="input w-40"
                    placeholder="ever (blank)"
                    value={percentMonths}
                    onChange={(e) => setPercentMonths(e.target.value)}
                    aria-label="Months the discount runs"
                  />
                  <span className="text-sm text-muted-foreground">months</span>
                </>
              ) : (
                <>
                  <input
                    type="number"
                    min={1}
                    max={36}
                    className="input w-20"
                    value={freeMonths}
                    onChange={(e) => setFreeMonths(Number(e.target.value))}
                    aria-label="Number of free months"
                  />
                  <span className="text-sm text-muted-foreground">months free</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input flex-1"
                placeholder="Why are they getting this?"
                value={concessionReason}
                onChange={(e) => setConcessionReason(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null || !concessionReason.trim()}
                onClick={() =>
                  concessionKind === "percent"
                    ? run("discount", {
                        action: "discount",
                        percent,
                        months: percentMonths ? Number(percentMonths) : undefined,
                        reason: concessionReason,
                      })
                    : run("free_months", {
                        action: "free_months",
                        months: freeMonths,
                        reason: concessionReason,
                      })
                }
              >
                {busy === "discount" || busy === "free_months" ? "Working…" : "Apply"}
              </button>
            </div>
          </div>
        )}
      </Card>

      {!billingExempt && (
        <Card
          title="Make this account free"
          body="Stops the subscription at Stripe and then marks the account comped, in that order. Nothing further is charged. This is not a discount: it does not expire and does not depend on Stripe being reachable."
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input flex-1"
              placeholder="Why is this account being made free?"
              value={compReason}
              onChange={(e) => setCompReason(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null || !compReason.trim()}
              onClick={() => run("make_free", { action: "make_free", reason: compReason })}
            >
              {busy === "make_free" ? "Working…" : "Cancel billing and make free"}
            </button>
          </div>
        </Card>
      )}

      <Card
        title="Trial"
        body="Extending counts from today when the trial has already lapsed, so a lapsed account gets the whole extra window rather than days added to a date in the past."
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={365}
            className="input w-24"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => run("extend", { action: "extend_trial", days })}
          >
            {busy === "extend" ? "Working…" : "Extend trial"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => run("restart", { action: "restart_trial" })}
          >
            {busy === "restart" ? "Working…" : "Start a fresh trial"}
          </button>
        </div>
      </Card>

      <Card
        title="Subscription"
        body="Cancels at Stripe as well as here. If Stripe refuses, nothing changes on our side. An account marked cancelled while still being charged is the worst of both."
      >
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => run("cancel", { action: "cancel" })}
        >
          {busy === "cancel" ? "Working…" : "Cancel subscription"}
        </button>
      </Card>

      {canImpersonate && (
        <Card
          title="Sign in as this customer"
          body={`Opens a one-hour support session as ${
            ownerEmail ?? "the owner"
          }. Outreach email is blocked and billing changes are refused for as long as it lasts, and every session is recorded.`}
        >
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={impersonate}
          >
            {busy === "impersonate" ? "Starting…" : "Start support session"}
          </button>
        </Card>
      )}

      <Card
        title={suspended ? "Reinstate" : "Suspend"}
        body="Suspension stops access and touches nothing else. It is reversible in one click, which makes it the right answer to almost everything that feels like it needs a deletion."
      >
        {suspended ? (
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={() => run("reactivate", { action: "reactivate" })}
          >
            {busy === "reactivate" ? "Working…" : "Reinstate this account"}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input flex-1"
              placeholder="Why is this account being suspended?"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null || !suspendReason.trim()}
              onClick={() => run("suspend", { action: "suspend", reason: suspendReason })}
            >
              {busy === "suspend" ? "Working…" : "Suspend"}
            </button>
          </div>
        )}
      </Card>

      {/*
        * The danger zone.
        *
        * Deletion used to be one button that committed a transaction removing
        * everything, with the copy admitting there was no undo and no backup.
        * The confirmation is typing the account name, which rules out
        * misclicks, so what it could not protect against were decisions: the
        * wrong one of two similar accounts, a cancellation reversed the next
        * morning, a support request misread. A scheduled deletion suspends the
        * account now, which is the part that was actually wanted, and defers
        * the part that cannot be taken back.
        */}
      <div className="rounded-lg border-2 border-risk/50 bg-risk/5 p-4">
        {deletion.state === "none" ? (
          <>
            <h3 className="font-semibold text-risk">Delete this account</h3>
            <p className="pt-1 text-sm text-muted-foreground">
              {orgName} is suspended immediately and the data is deleted{" "}
              {DELETION_GRACE_DAYS} days later. Cancel any time before then and nothing is
              lost, because nothing has been touched until the window runs out.
            </p>
            <p className="pt-2 text-sm text-muted-foreground">{RETENTION_EXPLANATION}</p>
            <div className="space-y-2 pt-3">
              <input
                className="input w-full"
                placeholder="Why is this account being deleted?"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder={`Type ${orgName} to confirm`}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded-md bg-risk px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  disabled={busy !== null || confirmName !== orgName || !deleteReason.trim()}
                  onClick={() =>
                    run("schedule_deletion", {
                      action: "schedule_deletion",
                      confirmName,
                      reason: deleteReason,
                    })
                  }
                >
                  {busy === "schedule_deletion" ? "Scheduling…" : "Schedule deletion"}
                </button>
              </div>
            </div>
            <details className="pt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Delete immediately instead
              </summary>
              <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                Skips the grace period and destroys everything now. Only for a request that
                cannot wait, such as an erasure demand with a deadline. There is no undo.
              </p>
              <button
                type="button"
                className="mt-2 rounded-md border border-risk px-3 py-2 text-xs font-semibold text-risk transition-opacity hover:opacity-80 disabled:opacity-40"
                disabled={busy !== null || confirmName !== orgName}
                onClick={() => run("delete", { confirmName }, "DELETE")}
              >
                {busy === "delete" ? "Deleting…" : "Delete permanently, now"}
              </button>
            </details>
          </>
        ) : (
          <>
            <h3 className="font-semibold text-risk">{deletion.headline}</h3>
            <p className="pt-1 text-sm text-muted-foreground">
              Suspended now, and the data goes when the window runs out.
              {deletionRequestedBy ? ` Requested by ${deletionRequestedBy}.` : ""}
              {deletionReason ? ` Reason: ${deletionReason}` : ""}
            </p>
            <p className="pt-2 text-sm text-muted-foreground">{deletion.retention}</p>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={busy !== null}
              onClick={() => run("cancel_deletion", { action: "cancel_deletion" })}
            >
              {busy === "cancel_deletion" ? "Cancelling…" : "Cancel deletion and restore access"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-inset p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="pt-1 text-sm text-muted-foreground">{body}</p>
      <div className="pt-3">{children}</div>
    </div>
  );
}
