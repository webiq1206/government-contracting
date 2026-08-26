"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SamEntity } from "@/lib/integrations/sam";
import {
  diffProfile,
  applicable,
  defaultSelection,
  summarize,
  patchFor,
  verdictLabel,
  type FieldDiff,
} from "@/lib/domain/sam-diff";

/**
 * Fill the company profile from the customer's own SAM.gov registration.
 *
 * Everything this imports is already on file at SAM, typed by the customer
 * when they registered: legal name, UEI, CAGE, address, NAICS codes, and the
 * set-aside certifications SAM records. Re-typing it into our form is
 * pointless work and a chance to fat-finger a UEI onto every future bid.
 *
 * The flow is search, compare, apply. Nothing is written until the customer has
 * seen the exact fields on screen and pressed the button, because a name
 * search can match a subsidiary or a stale registration and only they can tell.
 *
 * The comparison step is the audit's, and it is not decoration. This card used
 * to show only what SAM holds, so somebody who had corrected a legal name or
 * curated fourteen NAICS codes down from a registration listing forty pressed
 * one button and lost that work silently. A registration is authoritative
 * about how a company registered, not about how it has decided to bid. So
 * every field says what it would replace, list fields say what they would
 * drop, and an overwrite is unticked until the customer ticks it.
 */
export function SamProfileImport({
  samConnected,
  profile,
}: {
  samConnected: boolean;
  /** What is on file now, so the import can say what it would change. */
  profile: Record<string, unknown>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"uei" | "name">("uei");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<SamEntity[] | null>(null);
  const [applied, setApplied] = useState(false);
  /** The registration being compared, once one is picked out of the matches. */
  const [comparing, setComparing] = useState<SamEntity | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

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

  /** SAM's shape, in the profile's field names, so the two can be compared. */
  function incomingOf(entity: SamEntity): Record<string, unknown> {
    return {
      legal_name: entity.legalName ?? null,
      dba: entity.dba ?? null,
      uei: entity.uei ?? null,
      cage_code: entity.cageCode ?? null,
      physical_address: entity.physicalAddress ?? null,
      entity_state: entity.entityState ?? null,
      business_structure: entity.structure ?? null,
      naics_codes: entity.naicsCodes,
      certifications: entity.certifications,
    };
  }

  function compare(entity: SamEntity) {
    const diffs = diffProfile(profile, incomingOf(entity));
    setComparing(entity);
    setSelected(defaultSelection(diffs));
    setError(null);
  }

  async function apply(entity: SamEntity, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {

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
      setComparing(null);
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
        <h2 className="text-sm font-semibold text-slate-900">Import from SAM.gov</h2>
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
        <h2 className="text-sm font-semibold text-slate-900">Import from SAM.gov</h2>
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

          {comparing ? (
            <ImportComparison
              diffs={diffProfile(profile, incomingOf(comparing))}
              selected={selected}
              onToggle={(key) =>
                setSelected((cur) =>
                  cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
                )
              }
              busy={busy}
              onBack={() => {
                setComparing(null);
                setSelected([]);
              }}
              onApply={(patch) => apply(comparing, patch)}
              incoming={incomingOf(comparing)}
            />
          ) : (
            matches &&
            matches.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  {matches.length === 1
                    ? "One registration found. Check it is yours before importing."
                    : `${matches.length} registrations matched. Pick yours.`}
                </p>
                {matches.map((m, i) => (
                  <SamMatch key={m.uei ?? i} entity={m} busy={busy} onCompare={() => compare(m)} />
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function SamMatch({
  entity,
  busy,
  onCompare,
}: {
  entity: SamEntity;
  busy: boolean;
  onCompare: () => void;
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

      <button className="btn-primary mt-3 text-xs" onClick={onCompare} disabled={busy}>
        Compare with your profile
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

/**
 * The field-by-field comparison, and the decision it exists to force.
 *
 * Fills are ticked, replacements are not. That asymmetry is the whole design:
 * adding what you do not have is what somebody pressing "import" wants, and
 * overwriting what you typed is a separate decision that should cost a
 * deliberate click. List fields print what would be dropped by name, because
 * "replaces your NAICS codes" and "drops 238210 and 238220" are the same fact
 * told at two very different levels of usefulness.
 */
function ImportComparison({
  diffs,
  selected,
  onToggle,
  busy,
  onBack,
  onApply,
  incoming,
}: {
  diffs: FieldDiff[];
  selected: string[];
  onToggle: (key: string) => void;
  busy: boolean;
  onBack: () => void;
  onApply: (patch: Record<string, unknown>) => void;
  incoming: Record<string, unknown>;
}) {
  const choices = applicable(diffs);
  const unchanged = diffs.filter((d) => d.verdict === "same");
  const missing = diffs.filter((d) => d.verdict === "absent");
  const s = summarize(diffs, selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          What this would change
        </h3>
        <button type="button" className="tap text-xs text-slate-500 hover:text-accent" onClick={onBack}>
          Pick a different registration
        </button>
      </div>

      {choices.length === 0 ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-slate-600">
          Nothing to import. Every field this registration carries already matches what you
          have on file, so applying it would change nothing.
        </p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-slate-500">
            Ticked fields will be saved. Anything that would overwrite something you already
            have starts unticked, because the registration is a record of how you registered,
            not of how you have decided to bid.
          </p>
          <ul className="space-y-2">
            {choices.map((d) => (
              <li
                key={d.key}
                className={`rounded-md border px-3 py-2.5 ${
                  d.verdict === "replace" ? "border-review/40 bg-review/5" : "border-border bg-surface"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-accent"
                    checked={selected.includes(d.key)}
                    onChange={() => onToggle(d.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-slate-900">{d.label}</span>
                      <span
                        className={`text-xs ${
                          d.verdict === "replace" ? "text-review" : "text-slate-500"
                        }`}
                      >
                        {verdictLabel(d.verdict)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                      {d.current == null ? (
                        <>Nothing on file. SAM has <strong className="font-medium">{d.incoming}</strong>.</>
                      ) : (
                        <>
                          You have <strong className="font-medium">{d.current}</strong>. SAM has{" "}
                          <strong className="font-medium">{d.incoming}</strong>.
                        </>
                      )}
                    </span>
                    {d.removed && d.removed.length > 0 && (
                      <span className="mt-1 block text-xs leading-relaxed text-risk">
                        Importing drops {d.removed.length}: {d.removed.join(", ")}.
                        {d.kept && d.kept.length > 0 ? ` Keeps ${d.kept.length}.` : ""}
                      </span>
                    )}
                    {d.added && d.added.length > 0 && d.verdict === "replace" && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                        Adds {d.added.length}: {d.added.join(", ")}.
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {(unchanged.length > 0 || missing.length > 0) && (
        <p className="text-xs leading-relaxed text-slate-500">
          {unchanged.length > 0 && (
            <>
              Already matching: {unchanged.map((d) => d.label).join(", ")}.{" "}
            </>
          )}
          {missing.length > 0 && (
            <>Not on this registration, so left alone: {missing.map((d) => d.label).join(", ")}.</>
          )}
        </p>
      )}

      {choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary text-xs"
            disabled={busy || s.empty}
            onClick={() => onApply(patchFor(diffs, selected, incoming))}
          >
            {busy
              ? "Importing..."
              : s.empty
                ? "Nothing selected"
                : `Import ${s.fills + s.replaces} field${s.fills + s.replaces === 1 ? "" : "s"}`}
          </button>
          {s.losing > 0 && (
            <span className="text-xs text-risk">
              This will drop {s.losing} entr{s.losing === 1 ? "y" : "ies"} you have on file.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
