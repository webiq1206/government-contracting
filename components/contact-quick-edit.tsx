"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * A tiny "✎" button + popover form that lets the operator correct a sub's
 * contact info (email, phone, website, contact name) from ANY screen — Call
 * Queue cards, the subs list, the call workspace — without navigating to the
 * profile page. Saves through the same whitelisted POST /api/subs/[id]
 * endpoint the full profile editor uses, then refreshes the current view.
 *
 * All clicks stop propagation so it can live inside clickable cards.
 */
export function ContactQuickEdit({
  subId,
  companyName,
  email,
  phone,
  website,
  ownerName,
  className = "",
  onSaved,
}: {
  subId: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  website?: string | null;
  ownerName?: string | null;
  className?: string;
  /** Called after a successful save with the new values (empty string -> null). */
  onSaved?: (values: {
    email: string | null;
    phone: string | null;
    website: string | null;
    owner_name: string | null;
  }) => void;
}) {
  const router = useRouter();
  const requestPending = useRef(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState({
    email: email ?? "",
    phone: phone ?? "",
    website: website ?? "",
    owner_name: ownerName ?? "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (requestPending.current) return;
    requestPending.current = true;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        email: form.email,
        phone: form.phone,
      };
      if (website !== undefined) body.website = form.website;
      if (ownerName !== undefined) body.owner_name = form.owner_name;
      const res = await fetch(`/api/subs/${subId}`, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Contact changes were not saved. Check the fields and try again.");
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
      onSaved?.({
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        owner_name: form.owner_name.trim() || null,
      });
      router.refresh();
    } catch {
      setError(
        "The save was not confirmed. Reopen the record to check it before trying again. Your entries are still here."
      );
    } finally {
      requestPending.current = false;
      setSaving(false);
    }
  }

  return (
    <span
      className={`relative inline-flex ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Edit contact info for ${companyName}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Edit contact info"
        className="tap inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-surface hover:text-accent lg:h-7 lg:w-7"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) {
            // Reset the draft from the current values on every open so a
            // cancelled edit or an external refresh never leaves stale text.
            setForm({
              email: email ?? "",
              phone: phone ?? "",
              website: website ?? "",
              owner_name: ownerName ?? "",
            });
            setError(null);
          }
          setOpen((o) => !o);
        }}
      >
        ✎
      </button>
      <ConfirmDialog
        open={open}
        title={`Edit contact: ${companyName}`}
        confirmLabel="Save"
        busy={saving}
        onConfirm={() => void save()}
        onCancel={() => { setOpen(false); setError(null); }}
        body={<div className="space-y-3">
              <QF label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} placeholder="name@company.com" />
              <QF label="Phone" type="tel" value={form.phone} onChange={(v) => set("phone", v)} placeholder="(916) 555-0100" />
              {website !== undefined && (
                <QF label="Website" value={form.website} onChange={(v) => set("website", v)} placeholder="https://" />
              )}
              {ownerName !== undefined && (
                <QF label="Contact name" value={form.owner_name} onChange={(v) => set("owner_name", v)} />
              )}

          {error && <p className="text-xs text-risk" role="alert">{error}</p>}
        </div>}
      />
    </span>
  );
}

function QF({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="label mb-0.5 block text-[11px]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        // Keep typing from triggering page/card shortcuts, but let Escape
        // bubble to the popover's dialog handler so it closes the popover.
        onKeyDown={(e) => {
          if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
        }}
        className="input py-1 text-sm"
      />
    </label>
  );
}
