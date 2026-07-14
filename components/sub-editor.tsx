"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneLink, EmailLink } from "@/components/contact-link";

export interface EditableSub {
  id: string;
  company_name: string;
  owner_name: string | null;
  email: string | null;
  email_verified: boolean;
  phone: string | null;
  website: string | null;
  license_number: string | null;
  license_status: string | null;
  sam_excluded: boolean;
  trade_categories: string[];
  address: string | null;
  city: string | null;
  state: string | null;
  is_preferred: boolean;
  reviews_summary: string | null;
}

const LICENSE_OPTIONS = ["", "active", "expired", "unknown", "not_found"];

/**
 * The Contact & Verification card, now editable in place. Read mode shows
 * click-to-call / click-to-email links; the Edit button swaps in a full form so
 * an operator can correct any field. The machine-maintained SAM check and
 * verification badge stay read-only.
 */
export function SubEditor({ sub }: { sub: EditableSub }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    company_name: sub.company_name ?? "",
    owner_name: sub.owner_name ?? "",
    email: sub.email ?? "",
    phone: sub.phone ?? "",
    website: sub.website ?? "",
    license_number: sub.license_number ?? "",
    license_status: sub.license_status ?? "",
    address: sub.address ?? "",
    city: sub.city ?? "",
    state: sub.state ?? "",
    trade_categories: (sub.trade_categories ?? []).join(", "),
    is_preferred: sub.is_preferred,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/subs/${sub.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Edit subcontractor</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <F label="Company name" value={form.company_name} onChange={(v) => set("company_name", v)} />
          <F label="Owner / contact name" value={form.owner_name} onChange={(v) => set("owner_name", v)} />
          <F label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
          <F label="Phone" type="tel" value={form.phone} onChange={(v) => set("phone", v)} placeholder="(916) 555-0100" />
          <F label="Website" value={form.website} onChange={(v) => set("website", v)} placeholder="https://" />
          <label className="block">
            <span className="label mb-1 block">License status</span>
            <select
              className="input"
              value={form.license_status}
              onChange={(e) => set("license_status", e.target.value)}
            >
              {LICENSE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o === "" ? "Unknown / not set" : o.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <F label="License number" value={form.license_number} onChange={(v) => set("license_number", v)} />
          <F label="Trades (comma-separated)" value={form.trade_categories} onChange={(v) => set("trade_categories", v)} placeholder="Plumbing, Mechanical" />
          <F label="Address" value={form.address} onChange={(v) => set("address", v)} />
          <F label="City" value={form.city} onChange={(v) => set("city", v)} />
          <F label="State" value={form.state} onChange={(v) => set("state", v)} placeholder="CA" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={form.is_preferred}
            onChange={(e) => set("is_preferred", e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Mark as a preferred subcontractor
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
          >
            Cancel
          </button>
          {error && <span className="text-sm text-risk">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Contact &amp; Verification</h2>
        <button className="btn-ghost text-xs" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="label block">Email</span>
          <EmailLink email={sub.email} className="text-accent hover:underline" />
          {sub.email_verified && (
            <span className="badge ml-2 bg-pursue/15 text-pursue">Verified</span>
          )}
        </div>
        <div>
          <span className="label block">Phone</span>
          <PhoneLink phone={sub.phone} className="text-accent hover:underline" />
        </div>
        <div>
          <span className="label block">Website</span>
          {sub.website ? (
            <a
              href={sub.website}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {sub.website}
            </a>
          ) : (
            <span className="text-slate-400">-</span>
          )}
        </div>
        <div>
          <span className="label block">License status</span>
          <span className="text-slate-800">{sub.license_status ?? "-"}</span>
        </div>
        <div>
          <span className="label block">SAM exclusion</span>
          {sub.sam_excluded ? (
            <span className="badge bg-risk/15 text-risk">Excluded</span>
          ) : (
            <span className="badge bg-pursue/15 text-pursue">Clear</span>
          )}
        </div>
        <div>
          <span className="label block">Trades</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {(sub.trade_categories ?? []).map((t) => (
              <span key={t} className="badge bg-slate-200 text-slate-700">
                {t}
              </span>
            ))}
            {(sub.trade_categories?.length ?? 0) === 0 && (
              <span className="text-slate-500">-</span>
            )}
          </div>
        </div>
      </div>
      {sub.reviews_summary && (
        <div className="border-t border-border pt-3">
          <span className="label block">Reviews summary</span>
          <p className="mt-1 text-sm text-slate-700">{sub.reviews_summary}</p>
        </div>
      )}
    </div>
  );
}

function F({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </label>
  );
}
