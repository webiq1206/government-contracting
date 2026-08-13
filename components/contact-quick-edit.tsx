"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      setOpen(false);
      onSaved?.({
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        owner_name: form.owner_name.trim() || null,
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <span
      className={`relative inline-flex ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Edit contact info for ${companyName}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Edit contact info"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-400 hover:bg-surface hover:text-accent md:h-7 md:w-7"
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
      {open && (
        <>
          {/* click-away backdrop */}
          <span
            className="fixed inset-0 z-40 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              setError(null);
            }}
          />
          <span
            role="dialog"
            aria-label={`Edit contact: ${companyName}`}
            className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 block max-h-[70vh] overflow-y-auto rounded-lg border border-border/55 bg-surface p-4 text-left text-foreground shadow-lg dark:border-white/10 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-6 sm:max-h-none sm:w-72 sm:p-3"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // Escape closes this popover only — don't let it bubble to the
              // call workspace's global Escape (which closes the slide-over).
              if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
                setError(null);
              }
            }}
          >
            <span className="mb-2 block text-xs font-semibold text-slate-900">
              Edit contact: {companyName}
            </span>
            <span className="block space-y-2">
              <QF label="Email" type="email" autoFocus value={form.email} onChange={(v) => set("email", v)} placeholder="name@company.com" />
              <QF label="Phone" type="tel" value={form.phone} onChange={(v) => set("phone", v)} placeholder="(916) 555-0100" />
              {website !== undefined && (
                <QF label="Website" value={form.website} onChange={(v) => set("website", v)} placeholder="https://" />
              )}
              {ownerName !== undefined && (
                <QF label="Contact name" value={form.owner_name} onChange={(v) => set("owner_name", v)} />
              )}
            </span>
            <span className="mt-3 flex items-center gap-2">
              <button type="button" className="btn-primary text-xs" onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>
            </span>
            {error && <span className="mt-2 block text-xs text-risk">{error}</span>}
          </span>
        </>
      )}
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
          if (e.key !== "Escape") e.stopPropagation();
        }}
        className="input py-1 text-sm"
      />
    </label>
  );
}
