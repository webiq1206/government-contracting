"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SUBMISSION_METHOD_LABEL,
  SUBMISSION_METHODS,
  type SubmissionMethod,
} from "@/lib/domain/submission-state";
import type { ProofOption } from "@/components/mark-as-sent";

/**
 * Recording a send, on a phone.
 *
 * This is where the operator actually is. They have just finished uploading
 * six files to a government portal on a laptop, or on the phone itself, and
 * the confirmation screen is in front of them right now. A minute later it is
 * gone, and the record of this bid becomes somebody's memory of a Tuesday.
 *
 * The desktop form asks for eight things in a grid and refuses to submit
 * without a proof document, which on a phone meant: leave this screen, go to
 * the Files tab, upload something, come back, and start again. In practice
 * that is a workflow you cannot finish on a phone, which is the thing the
 * brief says must not exist.
 *
 * So: one question per screen, the proof captured with the camera right here,
 * and the controls pinned above the home indicator rather than under it. The
 * only step that cannot be skipped is the proof, because the proof is the
 * entire reason the record is worth more than a memory.
 */

const STEPS = ["how", "when", "proof", "confirm"] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLE: Record<Step, string> = {
  how: "How did you send it?",
  when: "When did it go?",
  proof: "What proves it arrived?",
  confirm: "Check and record",
};

export function SentConfirmationFlow({
  opportunityId,
  proofOptions,
  onClose,
}: {
  opportunityId: string;
  proofOptions: ProofOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("how");
  const [method, setMethod] = useState<SubmissionMethod>("portal");
  const [destination, setDestination] = useState("");
  const [sentAt, setSentAt] = useState(() => localNow());
  // The phone knows its own zone. Asked-for-from-memory is a worse record than
  // the one the device already has, and a deadline dispute turns on it.
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || ""
  );
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [options, setOptions] = useState<ProofOption[]>(proofOptions);
  const [proofDocumentId, setProofDocumentId] = useState("");
  const [attestation, setAttestation] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The flow covers the page, so the page must not scroll behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const index = STEPS.indexOf(step);

  /** What is missing on this step, in a sentence. Null when it can advance. */
  function blocking(): string | null {
    if (step === "how" && !destination.trim()) {
      return "Say where it went: the portal name, or the address you emailed.";
    }
    if (step === "when" && (!sentAt || !timezone.trim())) {
      return "The time and the timezone both matter. A deadline argument turns on which clock you read.";
    }
    if (step === "proof" && !proofDocumentId) {
      return "Attach the confirmation. Without it this record is a memory, which is the thing it exists to replace.";
    }
    if (step === "confirm" && !attestation.trim()) {
      return "Say what you did, in your own words.";
    }
    return null;
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", file.name || "Submission receipt");
      // Not a reserved package kind: those are cleared and rewritten on the
      // next package build, which would delete the operator's own proof.
      body.append("kind", "submission_proof");
      const res = await fetch(`/api/opportunities/${opportunityId}/documents`, {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That file could not be saved.");
        return;
      }
      const added: ProofOption = {
        id: String(data.id ?? data.documentId ?? ""),
        name: file.name || "Submission receipt",
      };
      if (!added.id) {
        setError("The file saved but did not come back with an id. Pick it from the list instead.");
        return;
      }
      setOptions((o) => [added, ...o]);
      setProofDocumentId(added.id);
    } catch {
      setError("That file could not be saved. Check the connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function record() {
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
          proofDocumentId,
          attestation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That could not be recorded.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("That could not be recorded. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const problem = blocking();

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Record how you sent the package"
    >
      {/* Header sits below the notch. */}
      <div
        className="flex items-center justify-between border-b border-border px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button type="button" className="text-sm underline underline-offset-2" onClick={onClose}>
          Cancel
        </button>
        <p className="text-xs text-muted-foreground">
          Step <span className="num">{index + 1}</span> of{" "}
          <span className="num">{STEPS.length}</span>
        </p>
      </div>

      <div className="h-1 w-full bg-muted">
        <div
          className="h-1 bg-accent transition-all"
          style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <h2 className="font-display text-2xl font-normal text-foreground">{STEP_TITLE[step]}</h2>

        {step === "how" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Brost Co does not deliver the package. This records what you did, so the file
              can say what happened rather than that somebody pressed a button.
            </p>
            <label className="block">
              <span className="label">How</span>
              <select
                className="input w-full"
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
            <label className="block">
              <span className="label">Where</span>
              <input
                className="input w-full"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="SAM.gov, or the officer's address"
                autoComplete="off"
              />
            </label>
          </div>
        )}

        {step === "when" && (
          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="label">Date and time</span>
              <input
                type="datetime-local"
                className="input w-full"
                value={sentAt}
                onChange={(e) => setSentAt(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Timezone</span>
              <input
                className="input w-full"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Taken from this phone. Change it only if you sent it from somewhere else.
              </span>
            </label>
            <label className="block">
              <span className="label">Confirmation number</span>
              <input
                className="input w-full"
                value={confirmationNumber}
                onChange={(e) => setConfirmationNumber(e.target.value)}
                placeholder="If the portal gave you one"
                inputMode="text"
                autoComplete="off"
              />
              {/* Optional on purpose. Plenty of portals issue none, and a
                  required field gets filled in with something untrue. */}
              <span className="mt-1 block text-xs text-muted-foreground">
                Leave it empty rather than inventing one.
              </span>
            </label>
          </div>
        )}

        {step === "proof" && (
          <ProofStep
            options={options}
            proofDocumentId={proofDocumentId}
            uploading={uploading}
            onChoose={setProofDocumentId}
            onFile={(f) => void upload(f)}
          />
        )}

        {step === "confirm" && (
          <div className="mt-4 space-y-4">
            <dl className="divide-y divide-border rounded-md border border-border">
              <Row label="How" value={SUBMISSION_METHOD_LABEL[method]} />
              <Row label="Where" value={destination} />
              <Row label="When" value={`${sentAt.replace("T", " ")} ${timezone}`} />
              <Row
                label="Confirmation number"
                value={confirmationNumber || "None issued"}
              />
              <Row
                label="Proof"
                value={options.find((o) => o.id === proofDocumentId)?.name ?? "Nothing chosen"}
              />
            </dl>
            <label className="block">
              <span className="label">What you did</span>
              <textarea
                className="input w-full"
                rows={3}
                value={attestation}
                onChange={(e) => setAttestation(e.target.value)}
                placeholder="Uploaded all six files to the portal and saw the success screen."
              />
            </label>
            <p className="text-xs text-muted-foreground">
              This records the send against your name. The agency has not acknowledged it yet,
              and a follow-up stays owed until a receipt is on file.
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-risk">{error}</p>}
      </div>

      {/*
        Pinned above the home indicator.
        Without the safe-area padding the primary button sits underneath the
        gesture bar on every recent iPhone, where a tap either does nothing or
        dismisses the browser.
      */}
      <div
        className="border-t border-border bg-background px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {problem && <p className="mb-2 text-xs text-muted-foreground">{problem}</p>}
        <div className="flex gap-3">
          {index > 0 && (
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => setStep(STEPS[index - 1]!)}
              disabled={busy}
            >
              Back
            </button>
          )}
          {step === "confirm" ? (
            <button
              type="button"
              className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void record()}
              disabled={busy || problem != null}
            >
              {busy ? "Recording" : "Mark as sent"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setStep(STEPS[index + 1]!)}
              disabled={problem != null || uploading}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The proof step, exported so its two load-bearing attributes can be asserted.
 *
 * `capture="environment"` opens the camera directly rather than the photo
 * library, and it is what makes this record possible at all: the operator is
 * looking at a confirmation screen that will not exist in an hour, and sending
 * them to a photo roll to find a screenshot they have not taken yet is the
 * same as sending them to the Files tab. Both attributes are one word each in
 * a diff and neither announces itself when it goes.
 */
export function ProofStep({
  options,
  proofDocumentId,
  uploading,
  onChoose,
  onFile,
}: {
  options: ProofOption[];
  proofDocumentId: string;
  uploading: boolean;
  onChoose: (id: string) => void;
  onFile: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        The confirmation screen is in front of you now and will not be in an hour. Photograph
        it.
      </p>
      <div className="grid gap-3">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => cameraInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Saving" : "Take a photo of the confirmation"}
        </button>
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          Choose a file instead
        </button>
      </div>
      {/* On a desktop browser `capture` is ignored and the file picker opens,
          which is the right fallback rather than a broken control. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {options.length > 0 && (
        <label className="block">
          <span className="label">Or one already on this bid</span>
          <select
            className="input w-full"
            value={proofDocumentId}
            onChange={(e) => onChoose(e.target.value)}
          >
            <option value="">Nothing chosen</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

/** `datetime-local` wants local wall time, and `toISOString` is UTC. */
function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}
