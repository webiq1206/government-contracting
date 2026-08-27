"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { offersFor, roleLabel, type PairingFacts, type SubAction } from "@/lib/domain/sub-actions";

/**
 * Everything an operator can do to one subcontractor on one bid, in one row.
 *
 * The panel used to offer exactly one control, and everything else had to be
 * done from the subcontractor's own record, one at a time, with no way back to
 * the bid it was being done for. A firm that bounced meant leaving the page to
 * fix an address; three firms quoting meant no way to say which one was being
 * priced.
 *
 * Unavailable actions stay visible and say why. A control that vanishes when
 * it will not work teaches an operator that the product is inconsistent; one
 * that explains itself teaches them what to fix, and the reason is nearly
 * always something they could correct in ten seconds.
 */
export function SubActions({
  opportunityId,
  pairingId,
  subcontractorId,
  companyName,
  trade,
  facts,
  canAct,
  canSend,
}: {
  opportunityId: string;
  pairingId: string;
  subcontractorId: string;
  companyName: string;
  trade: string | null;
  facts: PairingFacts;
  /** Ranking and removal are bid decisions. */
  canAct: boolean;
  /** Sending is a separate permission from deciding. */
  canSend: boolean;
  }) {
  const router = useRouter();
  const [busy, setBusy] = useState<SubAction | "remove" | "restore" | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [panel, setPanel] = useState<"contact" | "remove" | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");

  async function post(
    action: string,
    body: Record<string, unknown> = {},
    marker: SubAction | "remove" | "restore"
  ) {
    setBusy(marker);
    setNote(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/subs/${pairingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setNote({ kind: "bad", text: data.error ?? "That did not work." });
        return;
      }
      setPanel(null);
      if (data.message) setNote({ kind: "ok", text: data.message });
      router.refresh();
    } catch {
      setNote({ kind: "bad", text: "Could not reach the server. Nothing changed." });
    } finally {
      setBusy(null);
    }
  }

  async function sourceMore() {
    setBusy("source_more");
    setNote(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/subs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setNote(
        res.ok
          ? { kind: "ok", text: data.message ?? "Queued." }
          : { kind: "bad", text: data.error ?? "That did not work." }
      );
      if (res.ok) router.refresh();
    } catch {
      setNote({ kind: "bad", text: "Could not reach the server. Nothing changed." });
    } finally {
      setBusy(null);
    }
  }

  const offers = new Map(offersFor(facts).map((o) => [o.action, o]));
  const off = (a: SubAction) => offers.get(a)?.unavailable ?? null;

  return (
    <div className="mt-2">
      {facts.removed ? (
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
          <p className="text-xs text-foreground">
            {companyName} is off this bid. Everything sent to them stays on the record.
          </p>
          {canAct && (
            <button
              type="button"
              className="tap mt-1 text-xs text-accent hover:underline"
              disabled={busy !== null}
              onClick={() => void post("restore", {}, "restore")}
            >
              Put them back on it
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="badge bg-surface-raised text-slate-600">{roleLabel(facts.role)}</span>

          {canAct && (
            <>
              <Act
                label={facts.role === "primary" ? "Unrank" : "Make primary"}
                title={
                  facts.role === "primary"
                    ? "Take the primary mark off. The trade goes back to nobody picked."
                    : "The firm being priced for this trade."
                }
                busy={busy === "mark_primary"}
                disabled={busy !== null}
                onClick={() => void post("mark_primary", {}, "mark_primary")}
              />
              <Act
                label={facts.role === "backup" ? "Unrank" : "Make backup"}
                title="The fallback if the primary falls through."
                busy={busy === "mark_backup"}
                disabled={busy !== null}
                onClick={() => void post("mark_backup", {}, "mark_backup")}
              />
            </>
          )}

          {canSend && (
            <Act
              label="Send again"
              off={off("resend")}
              busy={busy === "resend"}
              disabled={busy !== null}
              onClick={() => void post("resend", {}, "resend")}
            />
          )}
          {canSend && (
            <Act
              label="Queue a call"
              off={off("call")}
              busy={busy === "call"}
              disabled={busy !== null}
              onClick={() => void post("call", {}, "call")}
            />
          )}

          {canAct && (
            <button
              type="button"
              className="tap text-xs text-accent hover:underline"
              aria-expanded={panel === "contact"}
              onClick={() => {
                setEmail("");
                setPhone("");
                setPanel(panel === "contact" ? null : "contact");
              }}
            >
              Fix contact
            </button>
          )}
          {canAct && (
            <button
              type="button"
              className="tap text-xs text-accent hover:underline"
              aria-expanded={panel === "remove"}
              onClick={() => {
                setReason("");
                setPanel(panel === "remove" ? null : "remove");
              }}
            >
              Take off the bid
            </button>
          )}
          {canSend && trade && (
            <Act
              label={`Find more ${trade} firms`}
              busy={busy === "source_more"}
              disabled={busy !== null}
              onClick={() => void sourceMore()}
            />
          )}

          {/* Going somewhere, not changing anything. Links, so they open in a
              new tab, come back with the back button, and can be copied. */}
          <Link
            href={`/opportunity/${opportunityId}#pricing`}
            className="tap text-xs text-accent hover:underline"
          >
            Enter quote
          </Link>
          <Reader
            label="See what they got"
            off={off("view_packet")}
            href={`/subs/${subcontractorId}#communications`}
          />
          <Reader
            label="See the thread"
            off={off("view_thread")}
            href={
              facts.hasThread
                ? `/communications?c=${encodeURIComponent(facts.threadKey ?? "")}`
                : "#"
            }
          />
        </div>
      )}

      {panel === "contact" && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-raised p-3">
          <p className="text-xs text-muted-foreground">
            A corrected address goes back for verification before outreach will send to it.
            Leave a field empty to keep what is on file.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1 block">Email</span>
              <input
                type="email"
                className="input h-11 w-full lg:h-9"
                value={email}
                placeholder={facts.hasEmail ? "Replace the address on file" : "None on file"}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label mb-1 block">Phone</span>
              <input
                type="tel"
                className="input h-11 w-full lg:h-9"
                value={phone}
                placeholder={facts.hasPhone ? "Replace the number on file" : "None on file"}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy !== null || (!email.trim() && !phone.trim())}
              onClick={() =>
                void post(
                  "correct_contact",
                  {
                    ...(email.trim() ? { email: email.trim() } : {}),
                    ...(phone.trim() ? { phone: phone.trim() } : {}),
                  },
                  "correct_contact"
                )
              }
            >
              {busy === "correct_contact" ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "remove" && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-surface-raised p-3">
          <p className="text-xs text-muted-foreground">
            {companyName} comes off {trade ?? "this bid"}. Nothing is deleted: every email,
            reply and call stays on the record.
          </p>
          <label className="block">
            <span className="label mb-1 block">Why</span>
            <input
              type="text"
              className="input h-11 w-full lg:h-9"
              value={reason}
              placeholder="Declined, too far out, or priced above the others"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !reason.trim()}
              onClick={() => void post("remove", { reason: reason.trim() }, "remove")}
            >
              {busy === "remove" ? "Saving…" : "Take off the bid"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPanel(null)}>
              Cancel
            </button>
            {!reason.trim() && (
              <span className="text-xs text-muted-foreground">
                Say why. A removal with no reason tells the next person nothing.
              </span>
            )}
          </div>
        </div>
      )}

      {note && (
        <p
          role="status"
          className={`mt-1.5 text-xs ${note.kind === "bad" ? "text-risk" : "text-muted-foreground"}`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/**
 * One control that does something.
 *
 * When it cannot, it stays on screen, unpressable, carrying the reason as its
 * title and as text a screen reader reaches. Hiding it would leave an operator
 * comparing two rows and unable to tell why one of them offers less.
 */
function Act({
  label,
  title,
  off,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  title?: string;
  off?: string | null;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  if (off) {
    return (
      <span className="tap text-xs text-muted-foreground" title={off}>
        {label} <span className="sr-only">is unavailable: {off}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      className="tap text-xs text-accent hover:underline disabled:text-muted-foreground"
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? "Working…" : label}
    </button>
  );
}

/** One control that goes somewhere. Same treatment when there is nowhere. */
function Reader({ label, off, href }: { label: string; off: string | null; href: string }) {
  if (off) {
    return (
      <span className="tap text-xs text-muted-foreground" title={off}>
        {label} <span className="sr-only">is unavailable: {off}</span>
      </span>
    );
  }
  return (
    <Link href={href} className="tap text-xs text-accent hover:underline">
      {label}
    </Link>
  );
}
