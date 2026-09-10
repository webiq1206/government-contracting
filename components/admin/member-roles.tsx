"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { AdminAccountMember } from "@/lib/admin/accounts";

const ROLES = ["owner", "admin", "operator", "estimator", "member", "viewer"] as const;

/**
 * Who is on the account, and what each of them may do.
 *
 * Two rules the server enforces and this UI states up front rather than
 * letting somebody discover them from an error: the last owner cannot be
 * demoted, and handing the account over is one deliberate action with a
 * confirmation, not two role edits with a broken state in the middle.
 */
export function MemberRoles({
  orgId,
  members,
}: {
  orgId: string;
  members: AdminAccountMember[];
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [transferTo, setTransferTo] = useState<AdminAccountMember | null>(null);

  async function post(key: string, body: Record<string, unknown>) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/accounts/${orgId}`, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? "That did not work." });
        return false;
      }
      setNote({ ok: true, text: data.message ?? "Done." });
      router.refresh();
      return true;
    } catch {
      setNote({ ok: false, text: "Could not reach the server." });
      return false;
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  const owners = members.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-3">
      {note && (
        <p
          className={`rounded-md border px-4 py-3 text-sm ${
            note.ok ? "border-pursue/40 bg-pursue/5 text-pursue" : "border-risk/40 bg-risk/5 text-risk"
          }`}
          role={note.ok ? "status" : "alert"}
        >
          {note.text}
        </p>
      )}

      <ul className="divide-y divide-border/60 panel-inset text-sm">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <span className="min-w-0 basis-full break-words sm:min-w-[12rem] sm:flex-1 sm:basis-auto">
              <span className="block font-medium">{m.email}</span>
              {m.name && <span className="block text-muted-foreground">{m.name}</span>}
              {m.aliases.length > 0 && (
                <span className="block text-xs text-muted-foreground">
                  also signs in as {m.aliases.join(", ")}
                </span>
              )}
            </span>
            <label className="flex items-center gap-2 text-xs">
              <span className="sr-only">Role for {m.email}</span>
              <select
                aria-label={`Role for ${m.email}`}
                className="input h-8 w-32 text-xs"
                value={m.role}
                disabled={busy != null || (m.role === "owner" && owners <= 1)}
                title={
                  m.role === "owner" && owners <= 1
                    ? "The only owner cannot be demoted. Transfer ownership instead."
                    : undefined
                }
                onChange={(e) =>
                  void post(`role-${m.user_id}`, {
                    action: "set_role",
                    userId: m.user_id,
                    role: e.target.value,
                  })
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {m.role !== "owner" && (
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={busy != null}
                onClick={() => setTransferTo(m)}
              >
                Make owner
              </button>
            )}
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-4 py-4 text-muted-foreground">Nobody is on this account.</li>
        )}
      </ul>

      <ConfirmDialog
        open={transferTo != null}
        title={`Hand this account to ${transferTo?.email ?? ""}`}
        body={
          <>
            <p>
              {transferTo?.email} becomes the owner. The current owner keeps admin:
              handing an account over is not the same as being removed from it.
            </p>
            <p className="mt-2">
              Recorded in this account&rsquo;s admin history, like everything else done
              from here.
            </p>
          </>
        }
        confirmLabel="Transfer ownership"
        busy={busy === "transfer"}
        onConfirm={() => {
          if (!transferTo) return;
          void post("transfer", { action: "transfer_ownership", userId: transferTo.user_id }).then(
            (ok) => {
              if (ok) setTransferTo(null);
            }
          );
        }}
        onCancel={() => setTransferTo(null)}
      />
    </div>
  );
}
