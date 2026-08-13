"use client";

import { useState } from "react";
import { DOC_LABEL, type DocType } from "@/lib/domain/sub-compliance";

/**
 * Sending in a certificate of insurance.
 *
 * The expiry date is the only field that is genuinely required, and it is
 * required for insurance because the whole point of holding a certificate is
 * knowing when it stops being true. Carrier, policy number, and limits are
 * asked for because they save an operator a phone call, but a sub who only has
 * a photo of the certificate on their phone can still get through this in
 * under a minute.
 */
export function VendorDocUpload({
  token,
  docType,
  onCancel,
  onUploaded,
}: {
  token: string;
  docType: DocType;
  onCancel: () => void;
  onUploaded: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [coverage, setCoverage] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInsurance = docType.startsWith("coi_");

  async function submit() {
    if (!file) {
      setError("Attach the certificate first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("doc_type", docType);
      body.set("file", file);
      if (carrier.trim()) body.set("carrier", carrier.trim());
      if (policyNumber.trim()) body.set("policy_number", policyNumber.trim());
      if (effectiveAt) body.set("effective_at", effectiveAt);
      if (expiresAt) body.set("expires_at", expiresAt);
      // Entered in dollars, stored in cents like every other amount here.
      const dollars = Number(coverage.replace(/[^0-9.]/g, ""));
      if (coverage.trim() && Number.isFinite(dollars) && dollars > 0) {
        body.set("coverage_cents", String(Math.round(dollars * 100)));
      }

      const res = await fetch(`/api/vendor/${token}/documents`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That did not go through. Please try again.");
        return;
      }
      onUploaded(data.message ?? "Got it. We will check it over.");
    } catch {
      setError("That did not go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <label className="block">
        <span className="label mb-1 block">{DOC_LABEL[docType]}</span>
        <span className="mb-1.5 block text-xs leading-relaxed text-slate-500">
          A PDF from your broker is ideal. A clear photo of the certificate works too.
        </span>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,image/*,application/pdf"
          className="input"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </label>

      {isInsurance && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1 block">
                Policy expires <span className="font-normal text-risk">required</span>
              </span>
              <input
                type="date"
                className="input"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label mb-1 block">
                Policy starts <span className="ml-1 font-normal text-slate-400">optional</span>
              </span>
              <input
                type="date"
                className="input"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Text label="Carrier" value={carrier} onChange={setCarrier} placeholder="Travelers" />
            <Text label="Policy number" value={policyNumber} onChange={setPolicyNumber} />
            <Text
              label="Limit"
              value={coverage}
              onChange={setCoverage}
              placeholder="1,000,000"
              inputMode="numeric"
            />
          </div>
        </>
      )}

      {!isInsurance && (
        <label className="block">
          <span className="label mb-1 block">
            Expires <span className="ml-1 font-normal text-slate-400">if it has an expiry</span>
          </span>
          <input
            type="date"
            className="input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
      )}

      {error && <p className="text-sm text-risk">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={submit} disabled={busy || !file}>
          {busy ? "Sending..." : "Send it"}
        </button>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">
        {label} <span className="ml-1 font-normal text-slate-400">optional</span>
      </span>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
      />
    </label>
  );
}
