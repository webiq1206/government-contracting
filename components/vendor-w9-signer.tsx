"use client";

import { useMemo, useState } from "react";
import {
  EMPTY_W9,
  LLC_TAX_CLASSES,
  TAX_CLASSIFICATIONS,
  TIN_LABEL,
  W9_CERTIFICATION,
  W9_CERTIFICATION_HEADING,
  canonicalW9Text,
  formatTin,
  normalizeTin,
  validateW9,
  type TinType,
  type W9FormData,
} from "@/lib/domain/w9";

/**
 * Filling in and signing a W-9.
 *
 * Three deliberate choices, all of them about the signature being real:
 *
 *   1. Two steps, fill then review. The signer sees the finished document
 *      before agreeing to it, which is the difference between a signature and
 *      a checkbox. The review text comes from canonicalW9Text, the same
 *      function the server hashes and renders the PDF from, so what is on
 *      screen is provably what gets signed.
 *   2. The certification is printed in full and never collapsed behind a
 *      "terms" link. It is the sentence that carries the perjury exposure.
 *   3. Nothing is submitted until the box is ticked and a name is typed. The
 *      button stays disabled rather than failing after the fact.
 *
 * The TIN is masked while typing and lives only in this component's state
 * until submission. It is not put in localStorage, not in the URL, and not
 * logged.
 */
export function VendorW9Signer({
  token,
  companyName,
  onCancel,
  onSigned,
}: {
  token: string;
  companyName: string;
  onCancel: () => void;
  onSigned: (message: string) => void;
}) {
  const [form, setForm] = useState<W9FormData>(EMPTY_W9);
  const [step, setStep] = useState<"fill" | "review">("fill");
  const [showTin, setShowTin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  function set<K extends keyof W9FormData>(key: K, value: W9FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear a field's error the moment it is touched. Leaving stale red text
    // under an input somebody is actively fixing reads as "still wrong".
    setErrors((e) => (key in e ? { ...e, [key]: "" } : e));
  }

  const tinType = (form.tinType || "ssn") as TinType;

  // The document the signer is about to agree to. Regenerated from current
  // state so it can never lag behind an edit.
  const preview = useMemo(
    () =>
      canonicalW9Text(form, {
        signedName: form.signedName.trim() || "(not yet signed)",
        signedAt: new Date(),
        companyName,
      }),
    [form, companyName]
  );

  function toReview() {
    // Check everything except the signature, which does not exist yet: stand
    // in a valid name and consent so those two rules pass and any error left
    // belongs to a field on this step.
    const found = validateW9({ ...form, signedName: "placeholder", certified: true });
    setErrors(found);
    if (Object.keys(found).length === 0) setStep("review");
  }

  async function sign() {
    const found = validateW9(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    setFailure(null);
    try {
      const res = await fetch(`/api/vendor/${token}/w9`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fieldErrors) {
          setErrors(data.fieldErrors);
          setStep("fill");
        }
        setFailure(data.error ?? "That did not go through. Please try again.");
        return;
      }
      onSigned(data.message ?? "Your W-9 is signed and on file.");
    } catch {
      setFailure(
        "That did not go through. Check your connection and try again, or reply to our email."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "review") {
    return (
      <div className="mt-4 space-y-4 border-t border-border pt-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Check this over before signing</h3>
          <p className="mt-1 text-xs text-slate-600">
            This is exactly what your signature will be attached to. Your full number is not
            printed here, and it will not appear on the saved copy either.
          </p>
        </div>

        <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface/60 p-3 text-xs leading-relaxed text-slate-700">
          {preview}
        </pre>

        <div className="panel-inset p-3">
          <p className="text-xs font-semibold text-slate-900">{W9_CERTIFICATION_HEADING}</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-slate-700">
            {W9_CERTIFICATION.map((clause, i) => (
              <li key={i}>{clause}</li>
            ))}
          </ol>
        </div>

        <label className="flex items-start gap-2.5 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={form.certified}
            onChange={(e) => set("certified", e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span>
            I have read the certification above and I agree to it. I understand I am signing under
            penalty of perjury.
          </span>
        </label>
        {errors.certified && <p className="text-xs text-risk">{errors.certified}</p>}

        <label className="block">
          <span className="label mb-1 block">Type your full name to sign</span>
          <input
            className="input"
            value={form.signedName}
            onChange={(e) => set("signedName", e.target.value)}
            placeholder="Your name"
            autoComplete="name"
          />
          {errors.signedName && <p className="mt-1 text-xs text-risk">{errors.signedName}</p>}
        </label>

        <p className="text-xs leading-relaxed text-slate-500">
          Signing records your name, the time, and the address you are signing from, which is what
          makes an electronic signature valid under the E-SIGN Act.
        </p>

        {failure && <p className="text-sm text-risk">{failure}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            onClick={sign}
            disabled={submitting || !form.certified || form.signedName.trim().length < 2}
          >
            {submitting ? "Signing..." : "Sign and send"}
          </button>
          <button className="btn-ghost" onClick={() => setStep("fill")} disabled={submitting}>
            Back to the form
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <Field
        label="Name"
        hint="As it appears on your income tax return. For a sole proprietor this is your own name, not the business name."
        value={form.legalName}
        onChange={(v) => set("legalName", v)}
        error={errors.legalName}
        autoComplete="name"
      />
      <Field
        label="Business name (if different)"
        hint="Your DBA or trade name. Leave blank if it is the same as above."
        value={form.businessName}
        onChange={(v) => set("businessName", v)}
        error={errors.businessName}
        optional
      />

      <fieldset>
        <legend className="label mb-1.5 block">How is the business taxed?</legend>
        <div className="space-y-1.5">
          {TAX_CLASSIFICATIONS.map((c) => (
            <label key={c.value} className="flex items-start gap-2.5 text-sm text-slate-800">
              <input
                type="radio"
                name="taxClassification"
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                checked={form.taxClassification === c.value}
                onChange={() => set("taxClassification", c.value)}
              />
              <span>
                {c.label}
                {c.hint && <span className="block text-xs text-slate-500">{c.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        {errors.taxClassification && (
          <p className="mt-1 text-xs text-risk">{errors.taxClassification}</p>
        )}
      </fieldset>

      {form.taxClassification === "llc" && (
        <label className="block">
          <span className="label mb-1 block">The LLC is taxed as</span>
          <select
            className="input"
            value={form.llcTaxClass}
            onChange={(e) => set("llcTaxClass", e.target.value)}
          >
            <option value="">Choose one</option>
            {LLC_TAX_CLASSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            A single-member LLC that is not taxed as a corporation should choose &ldquo;Individual
            or sole proprietor&rdquo; above instead.
          </span>
          {errors.llcTaxClass && <p className="mt-1 text-xs text-risk">{errors.llcTaxClass}</p>}
        </label>
      )}

      {form.taxClassification === "other" && (
        <Field
          label="Describe the classification"
          value={form.otherDescription}
          onChange={(v) => set("otherDescription", v)}
          error={errors.otherDescription}
        />
      )}

      <Field
        label="Mailing address"
        hint="Where your 1099 should be sent. Use a PO box if that is where mail goes."
        value={form.address}
        onChange={(v) => set("address", v)}
        error={errors.address}
        autoComplete="street-address"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="City"
          value={form.city}
          onChange={(v) => set("city", v)}
          error={errors.city}
          autoComplete="address-level2"
        />
        <Field
          label="State"
          value={form.state}
          onChange={(v) => set("state", v.toUpperCase().slice(0, 2))}
          error={errors.state}
          placeholder="CA"
          autoComplete="address-level1"
        />
        <Field
          label="ZIP"
          value={form.zip}
          onChange={(v) => set("zip", v)}
          error={errors.zip}
          autoComplete="postal-code"
          inputMode="numeric"
        />
      </div>

      <fieldset className="panel-inset p-3">
        <legend className="label px-1">Taxpayer identification number</legend>
        <div className="space-y-1.5">
          {(["ssn", "ein"] as TinType[]).map((t) => (
            <label key={t} className="flex items-center gap-2.5 text-sm text-slate-800">
              <input
                type="radio"
                name="tinType"
                className="h-4 w-4 accent-accent"
                checked={form.tinType === t}
                onChange={() => set("tinType", t)}
              />
              {TIN_LABEL[t]}
              {t === "ein" && <span className="text-xs text-slate-500">(EIN)</span>}
            </label>
          ))}
        </div>
        {errors.tinType && <p className="mt-1 text-xs text-risk">{errors.tinType}</p>}

        <label className="mt-3 block">
          <span className="label mb-1 block">
            {form.tinType ? TIN_LABEL[form.tinType] : "Number"}
          </span>
          <div className="flex items-center gap-2">
            <input
              className="input"
              // Masked by default so the number is not sitting readable on a
              // phone screen in a truck. type=text with a toggle rather than
              // type=password, which mobile keyboards handle badly for digits.
              type={showTin ? "text" : "password"}
              inputMode="numeric"
              autoComplete="off"
              value={showTin ? formatTin(form.tin, tinType) : form.tin}
              onChange={(e) => set("tin", normalizeTin(e.target.value).slice(0, 9))}
              placeholder={tinType === "ssn" ? "123-45-6789" : "12-3456789"}
            />
            <button
              type="button"
              className="btn-ghost shrink-0 text-xs"
              onClick={() => setShowTin((v) => !v)}
            >
              {showTin ? "Hide" : "Show"}
            </button>
          </div>
          {errors.tin && <p className="mt-1 text-xs text-risk">{errors.tin}</p>}
          <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">
            Encrypted as soon as it reaches us. Only the last four digits are ever shown again, and
            the number is used for nothing except your 1099.
          </span>
        </label>
      </fieldset>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-700">
          Exempt payee or FATCA codes (rarely needed)
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Most subcontractors leave both blank. Fill them in only if your accountant has told you
          which codes apply.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Exempt payee code"
            value={form.exemptPayeeCode}
            onChange={(v) => set("exemptPayeeCode", v)}
            error={errors.exemptPayeeCode}
            optional
          />
          <Field
            label="FATCA exemption code"
            value={form.fatcaCode}
            onChange={(v) => set("fatcaCode", v)}
            error={errors.fatcaCode}
            optional
          />
        </div>
      </details>

      {failure && <p className="text-sm text-risk">{failure}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={toReview}>
          Review before signing
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  optional,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block">
      <span className="label mb-1 block">
        {label}
        {optional && <span className="ml-1 font-normal text-slate-400">optional</span>}
      </span>
      {hint && <span className="mb-1 block text-xs leading-relaxed text-slate-500">{hint}</span>}
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
      />
      {error && <p className="mt-1 text-xs text-risk">{error}</p>}
    </label>
  );
}
