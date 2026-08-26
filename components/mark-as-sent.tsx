"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SUBMISSION_METHOD_LABEL,
  SUBMISSION_METHODS,
  type SubmissionMethod,
} from "@/lib/domain/submission-state";

export interface ProofOption {
  id: string;
  name: string;
}

/**
 * Record that the package reached the agency, and what proves it.
 *
 * This exists because for almost every solicitation here, Brost Co does not
 * send anything: a person opens a government portal, uploads the files
 * themselves, and comes back. The old button said "Submit bid package" and set
 * `submitted_at`, which recorded an intention as a delivery.
 *
 * Every field below is something a person would need to defend the claim
 * later. The timezone is here because a deadline argument turns on which clock
 * the time was read on. The receipt is here because every portal produces a
 * screen that can be captured. The confirmation number is optional, because
 * plenty of portals do not issue one and a required field would be filled in
 * with something untrue.
 */
export function MarkAsSent({
  opportunityId,
  proofOptions,
  onUploadHref,
}: {
  opportunityId: string;
  /** Documents already on this opportunity that could be the receipt. */
  proofOptions: ProofOption[];
  /** Where to go to add one, when none is attached yet. */
  onUploadHref: string;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<SubmissionMethod>("portal");
  const [destination, setDestination] = useState("");
  const [sentAt, setSentAt] = useState(() => new Date().toISOString().slice(0, 16));
  // The browser knows the operator's zone. Prefilled rather than asked,
  // because somebody typing their own timezone from memory is a worse record
  // than the one their machine already has.
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || ""
  );
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [proofDocumentId, setProofDocumentId] = useState("");
  const [attestation, setAttestation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/sent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method,
          destination,
          sentAt: new Date(sentAt).toISOString(),
          timezone,
          confirmationNumber,
          proofDocumentId: proofDocumentId || undefined,
          attestation,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "That could not be recorded.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <p className="text-sm font-medium text-foreground">Record how you sent it</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Brost Co does not deliver the package. Fill this in after you have sent it, so
          the record can say what happened rather than that somebody pressed a button.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground">
          How
          <select
            className="input mt-1 w-full text-sm"
            value={method}
            onChange={(e) => setMethod(e.target.value as SubmissionMethod)}
          >
            {SUBMISSION_METHODS.filter((m) => m !== "connector").map((m) => (
              <option key={m} value={m}>
                {SUBMISSION_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-muted-foreground">
          Where
          <input
            className="input mt-1 w-full text-sm"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="SAM.gov, or the officer's address"
            required
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          When
          <input
            type="datetime-local"
            className="input mt-1 w-full text-sm"
            value={sentAt}
            onChange={(e) => setSentAt(e.target.value)}
            required
          />
        </label>

        <label className="block text-xs text-muted-foreground">
          Timezone
          <input
            className="input mt-1 w-full text-sm"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            required
          />
          {/* Said out loud because it looks like bureaucracy until it is the
              thing an argument turns on. */}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            A deadline dispute turns on which clock the time was read on.
          </span>
        </label>

        <label className="block text-xs text-muted-foreground">
          Confirmation number
          <input
            className="input mt-1 w-full text-sm"
            value={confirmationNumber}
            onChange={(e) => setConfirmationNumber(e.target.value)}
            placeholder="If the portal gave you one"
          />
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Optional. Leave it empty rather than inventing one.
          </span>
        </label>

        <label className="block text-xs text-muted-foreground">
          Receipt or screenshot
          {proofOptions.length > 0 ? (
            <select
              className="input mt-1 w-full text-sm"
              value={proofDocumentId}
              onChange={(e) => setProofDocumentId(e.target.value)}
              required
            >
              <option value="">Choose the proof you uploaded</option>
              {proofOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="mt-1 block text-xs">
              Upload the confirmation screen or email first, on the{" "}
              <a className="underline underline-offset-2" href={onUploadHref}>
                Files tab
              </a>
              .
            </span>
          )}
        </label>
      </div>

      <label className="block text-xs text-muted-foreground">
        What you did
        <textarea
          className="input mt-1 w-full text-sm"
          rows={2}
          value={attestation}
          onChange={(e) => setAttestation(e.target.value)}
          placeholder="Uploaded all six files to the portal and saw the success screen."
          required
        />
      </label>

      <button
        type="submit"
        className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy || proofOptions.length === 0}
      >
        {busy ? "Recording" : "Mark as sent"}
      </button>
      {error && <p className="text-xs text-risk">{error}</p>}
    </form>
  );
}
