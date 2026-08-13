"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VendorW9Signer } from "@/components/vendor-w9-signer";
import { VendorDocUpload } from "@/components/vendor-doc-upload";
import { REQUIRED_FOR_AWARD, DOC_LABEL, type DocType } from "@/lib/domain/sub-compliance";

export interface PortalDoc {
  id: string;
  doc_type: string;
  status: string;
  expires_at: string | null;
  carrier: string | null;
  signed_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

/** What the subcontractor is told about each item, in their words not ours. */
function stateFor(doc: PortalDoc | undefined): {
  tone: "todo" | "waiting" | "done" | "problem";
  label: string;
  detail: string | null;
} {
  if (!doc) return { tone: "todo", label: "Still needed", detail: null };
  if (doc.status === "rejected") {
    return {
      tone: "problem",
      label: "Needs another look",
      detail: doc.rejection_reason ?? "Please send a replacement.",
    };
  }
  if (doc.status === "expired") {
    return { tone: "problem", label: "Out of date", detail: "Send the current one when you can." };
  }
  if (!doc.verified_at) {
    return {
      tone: "waiting",
      label: "Received",
      detail: "Nothing more for you to do. We are checking it over.",
    };
  }
  if (doc.status === "expiring") {
    return {
      tone: "waiting",
      label: "On file, expiring soon",
      detail: doc.expires_at ? `Runs out ${friendlyDate(doc.expires_at)}.` : null,
    };
  }
  return {
    tone: "done",
    label: "On file",
    detail: doc.expires_at ? `Good through ${friendlyDate(doc.expires_at)}.` : null,
  };
}

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "an unknown date"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const TONE_CLASS: Record<string, string> = {
  todo: "bg-slate-200 text-slate-700",
  waiting: "bg-review/15 text-review",
  done: "bg-pursue/15 text-pursue",
  problem: "bg-risk/15 text-risk",
};

/**
 * The whole subcontractor experience: what is outstanding, and the two ways to
 * clear it.
 *
 * Laid out as a checklist rather than a form because the common case is a sub
 * who has already sent one of the three and only needs to do the rest. Opening
 * a five-page form on all of them would be the fastest way to have it
 * abandoned.
 */
export function VendorPortal({
  token,
  companyName,
  docs,
  blockReason,
  cleared,
}: {
  token: string;
  companyName: string;
  docs: PortalDoc[];
  blockReason: string | null;
  cleared: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<DocType | null>(null);
  const [justDone, setJustDone] = useState<string | null>(null);

  // The newest row per type is what the sub cares about; older ones are our
  // audit trail, not their problem.
  const latest = new Map<string, PortalDoc>();
  for (const d of docs) if (!latest.has(d.doc_type)) latest.set(d.doc_type, d);

  function afterSubmit(message: string) {
    setJustDone(message);
    setOpen(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {justDone && (
        <div className="card border-pursue/40 bg-pursue/5">
          <p className="text-sm font-medium text-slate-900">Thank you.</p>
          <p className="mt-1 text-sm text-slate-600">{justDone}</p>
        </div>
      )}

      {cleared && !justDone && (
        <div className="card border-pursue/40 bg-pursue/5">
          <p className="text-sm font-medium text-slate-900">You are all set.</p>
          <p className="mt-1 text-sm text-slate-600">
            Everything we need is on file. We will email you when there is work to quote, and we
            will chase you before anything runs out.
          </p>
        </div>
      )}

      {REQUIRED_FOR_AWARD.map((type) => {
        const doc = latest.get(type);
        const state = stateFor(doc);
        const isOpen = open === type;
        const isW9 = type === "w9";
        return (
          <section key={type} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">{DOC_LABEL[type]}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {isW9
                    ? "So we can pay you and send your 1099 in January. Sign it here, it takes a minute."
                    : "A current certificate from your broker, showing the policy dates."}
                </p>
                {state.detail && (
                  <p className="mt-1.5 text-xs text-slate-600">{state.detail}</p>
                )}
              </div>
              <span className={`badge shrink-0 ${TONE_CLASS[state.tone]}`}>{state.label}</span>
            </div>

            {!isOpen && (
              <button
                className={state.tone === "done" || state.tone === "waiting" ? "btn-ghost mt-3 text-xs" : "btn-primary mt-3"}
                onClick={() => setOpen(type)}
              >
                {state.tone === "done" || state.tone === "waiting"
                  ? isW9
                    ? "Sign a new one"
                    : "Send a newer certificate"
                  : isW9
                    ? "Fill in and sign"
                    : "Upload certificate"}
              </button>
            )}

            {isOpen && isW9 && (
              <VendorW9Signer
                token={token}
                companyName={companyName}
                onCancel={() => setOpen(null)}
                onSigned={afterSubmit}
              />
            )}
            {isOpen && !isW9 && (
              <VendorDocUpload
                token={token}
                docType={type}
                onCancel={() => setOpen(null)}
                onUploaded={afterSubmit}
              />
            )}
          </section>
        );
      })}

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          Send something else
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Commercial auto, a trade license, or anything else we have asked you for. Not required
          for every job, but useful to have on file.
        </p>
        <div className="mt-3 space-y-3">
          {(["coi_auto", "license", "other"] as DocType[]).map((type) => {
            const doc = latest.get(type);
            const state = stateFor(doc);
            return open === type ? (
              <VendorDocUpload
                key={type}
                token={token}
                docType={type}
                onCancel={() => setOpen(null)}
                onUploaded={afterSubmit}
              />
            ) : (
              <div key={type} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{DOC_LABEL[type]}</span>
                <div className="flex items-center gap-2">
                  {doc && <span className={`badge ${TONE_CLASS[state.tone]}`}>{state.label}</span>}
                  <button className="btn-ghost text-xs" onClick={() => setOpen(type)}>
                    Upload
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {blockReason && !cleared && (
        <p className="px-1 text-xs leading-relaxed text-slate-500">
          Until this is complete we cannot send you bid packages. Nothing is wrong on your end,
          it is simply what we have to hold as the prime contractor.
        </p>
      )}
    </div>
  );
}
