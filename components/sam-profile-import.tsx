"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SamEntity } from "@/lib/integrations/sam";

/**
 * Fill the company profile from the customer's own SAM.gov registration.
 *
 * Everything this imports is already on file at SAM, typed by the customer
 * when they registered: legal name, UEI, CAGE, address, NAICS codes, and the
 * set-aside certifications SAM records. Re-typing it into our form is
 * pointless work and a chance to fat-finger a UEI onto every future bid.
 *
 * The flow is search, review, apply. Nothing is written until the customer has
 * seen the exact fields on screen and pressed the button, because a name
 * search can match a subsidiary or a stale registration and only they can tell.
 */
export function SamProfileImport({ samConnected }: { samConnected: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"uei" | "name">("uei");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<SamEntity[] | null>(null);
  const [applied, setApplied] = useState(false);

  async function search() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setMatches(null);
    try {
      const res = await fetch("/api/profile/import-sam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "uei" ? { uei: value } : { name: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That search did not work.");
        return;
      }
      setMatches(data.entities ?? []);
      if (data.message) setMessage(data.message);
    } catch {
      setError("Could not reach SAM.gov. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function apply(entity: SamEntity) {
    setBusy(true);
    setError(null);
    try {
      // Only fields SAM actually returned are sent, so an incomplete
      // registration never blanks something the customer already typed.
      const patch: Record<string, unknown> = {};
      if (entity.legalName) patch.legal_name = entity.legalName;
      if (entity.dba) patch.dba = entity.dba;
      if (entity.uei) patch.uei = entity.uei;
      if (entity.cageCode) patch.cage_code = entity.cageCode;
      if (entity.physicalAddress) patch.physical_address = entity.physicalAddress;
      if (entity.entityState) patch.entity_state = entity.entityState;
      if (entity.structure) patch.business_structure = entity.structure;
      if (entity.naicsCodes.length) patch.naics_codes = entity.naicsCodes;
      if (entity.certifications.length) patch.certifications = entity.certifications;

      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save those details.");
        return;
      }
      setApplied(true);
      setMatches(null);
      router.refresh();
    } catch {
      setError("Could not save those details. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!samConnected) {
    return (
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Import from SAM.gov</h3>
        <p className="text-sm leading-relaxed text-slate-600">
          Once your SAM.gov key is connected, Brost Co can pull your registration straight
          into this profile: legal name, UEI, CAGE code, address, NAICS codes, and your
          set-aside certifications. Nothing to type twice.
        </p>
        <a href="/settings/integrations" className="btn-ghost w-fit text-xs">
          Connect SAM.gov first
        </a>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Import from SAM.gov</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Pull your own registration in rather than retyping it. You will see exactly what
          was found and can change anything before it is saved.
        </p>
      </div>

      {applied ? (
        <div className="rounded-md border border-pursue/40 bg-pursue/5 px-3 py-2.5">
          <p className="text-sm font-medium text-slate-900">Profile updated from SAM.gov.</p>
          <p className="mt-1 text-sm text-slate-600">
            Check the fields below and edit anything that is not right, then save. Your NAICS
            codes drive what Brost Co searches for, so it is worth a look.
          </p>
          <button
            className="btn-ghost mt-2 text-xs"
            onClick={() => {
              setApplied(false);
              setValue("");
            }}
          >
            Import a different registration
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["uei", "name"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={m === mode ? "btn-primary text-xs" : "btn-ghost text-xs"}
                onClick={() => {
                  setMode(m);
                  setValue("");
                  setMatches(null);
                  setMessage(null);
                  setError(null);
                }}
              >
                {m === "uei" ? "Search by UEI" : "Search by company name"}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="label mb-1 block">
              {mode === "uei" ? "Your UEI" : "Registered legal name"}
            </span>
            <div className="flex flex-wrap gap-2">
              <input
                className="input flex-1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={mode === "uei" ? "12 letters and numbers" : "Exactly as registered"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim() && !busy) search();
                }}
              />
              <button
                className="btn-primary shrink-0"
                onClick={search}
                disabled={busy || !value.trim()}
              >
                {busy ? "Searching..." : "Search"}
              </button>
            </div>
            <span className="mt-1 block text-xs text-slate-500">
              {mode === "uei"
                ? "On sam.gov under your entity registration. Fastest and always exact."
                : "Use the legal name on the registration, not a trading name."}
            </span>
          </label>

          {error && <p className="text-sm text-risk">{error}</p>}
          {message && <p className="text-sm text-slate-600">{message}</p>}

          {matches && matches.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {matches.length === 1
                  ? "One registration found. Check it is yours before importing."
                  : `${matches.length} registrations matched. Pick yours.`}
              </p>
              {matches.map((m, i) => (
                <SamMatch key={m.uei ?? i} entity={m} busy={busy} onApply={() => apply(m)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SamMatch({
  entity,
  busy,
  onApply,
}: {
  entity: SamEntity;
  busy: boolean;
  onApply: () => void;
}) {
  const inactive =
    entity.registrationStatus != null &&
    entity.registrationStatus.toLowerCase() !== "active";

  return (
    <div className="rounded-md border border-border bg-surface/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {entity.legalName ?? "Unnamed registration"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[entity.uei ? `UEI ${entity.uei}` : null, entity.cageCode ? `CAGE ${entity.cageCode}` : null, entity.physicalAddress]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {entity.registrationStatus && (
          <span
            className={`badge shrink-0 ${inactive ? "bg-risk/15 text-risk" : "bg-pursue/15 text-pursue"}`}
          >
            {entity.registrationStatus}
          </span>
        )}
      </div>

      <dl className="mt-3 space-y-1.5 text-xs">
        <Row
          label="NAICS codes"
          value={
            entity.naicsCodes.length
              ? `${entity.naicsCodes.length} found · ${entity.naicsCodes.slice(0, 6).join(", ")}${entity.naicsCodes.length > 6 ? "…" : ""}`
              : "None on the registration"
          }
        />
        <Row
          label="Certifications"
          value={entity.certifications.length ? entity.certifications.join(", ") : "None recorded"}
        />
        {entity.structure && <Row label="Structure" value={entity.structure} />}
      </dl>

      {/* An expired registration cannot win federal work. Importing it is still
          useful (the details are right), so this warns rather than blocks. */}
      {inactive && (
        <p className="mt-2 text-xs text-risk">
          This registration is not active at SAM. You can still import the details, but
          renew it before bidding.
        </p>
      )}
      {entity.naicsCodes.length === 0 && (
        <p className="mt-2 text-xs text-review">
          No NAICS codes on this registration, so you will need to add them by hand below.
          They are what Brost Co searches with.
        </p>
      )}

      <button className="btn-primary mt-3 text-xs" onClick={onApply} disabled={busy}>
        {busy ? "Importing..." : "Import these details"}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-slate-500">{label}:</dt>
      <dd className="min-w-0 flex-1 text-slate-700">{value}</dd>
    </div>
  );
}
