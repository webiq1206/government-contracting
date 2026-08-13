"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOC_LABEL, REQUIRED_FOR_AWARD, type DocType } from "@/lib/domain/sub-compliance";
import { maskedTin, type TinType } from "@/lib/domain/w9";
import { currency, shortDate } from "@/lib/format";

export interface PanelDoc {
  id: string;
  doc_type: string;
  status: string;
  storage_path: string | null;
  original_filename: string | null;
  carrier: string | null;
  policy_number: string | null;
  coverage_cents: string | number | null;
  expires_at: string | null;
  signed_name: string | null;
  signed_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  source: string | null;
  w9_legal_name: string | null;
  w9_tin_type: string | null;
  w9_tin_last4: string | null;
  created_at: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  active: "bg-pursue/15 text-pursue",
  expiring: "bg-review/15 text-review",
  pending: "bg-review/15 text-review",
  expired: "bg-risk/15 text-risk",
  rejected: "bg-risk/15 text-risk",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Current",
  expiring: "Expiring soon",
  pending: "Needs checking",
  expired: "Lapsed",
  rejected: "Rejected",
};

/**
 * The operator's view of a subcontractor's paperwork.
 *
 * The panel leads with whether work can go out, because that is the only
 * question anyone opens it to answer. Everything else, the documents, the
 * dates, the verify buttons, hangs underneath that answer.
 *
 * Two things staff cannot do from here, on purpose:
 *
 *   - Sign a W-9. Only the taxpayer can certify their own number under penalty
 *     of perjury, so the only route to a signature is the link this panel
 *     issues. Staff can still file a paper W-9 the sub already signed.
 *   - See a full taxpayer identification number. The last four is what a
 *     person needs to match a document against a record; the rest is held
 *     encrypted for filing and never rendered.
 */
export function SubCompliancePanel({
  subId,
  companyName,
  docs,
  blockReason,
  cleared,
  expiringSoon,
}: {
  subId: string;
  companyName: string;
  docs: PanelDoc[];
  blockReason: string | null;
  cleared: boolean;
  expiringSoon: { docType: DocType; expiresAt: string }[];
}) {
  const router = useRouter();
  const [link, setLink] = useState<{ url: string; ttlDays: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const latest = new Map<string, PanelDoc>();
  for (const d of docs) if (!latest.has(d.doc_type)) latest.set(d.doc_type, d);
  const history = docs.filter((d) => latest.get(d.doc_type)?.id !== d.id);

  async function issueLink() {
    setBusy("link");
    setError(null);
    try {
      const res = await fetch(`/api/subs/${subId}/portal-link`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create a link.");
        return;
      }
      setLink({ url: data.url, ttlDays: data.ttlDays });
      setCopied(false);
    } finally {
      setBusy(null);
    }
  }

  async function decide(docId: string, action: "verify" | "reject") {
    setBusy(docId);
    setError(null);
    try {
      const res = await fetch(`/api/subs/${subId}/documents/${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "reject" ? reason : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That did not save.");
        return;
      }
      setRejecting(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-4" id="compliance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Compliance</h2>
          <p className="mt-1 text-xs text-slate-500">
            W-9 and insurance. A subcontractor without all three current cannot be sent a bid
            package.
          </p>
        </div>
        <span className={`badge shrink-0 ${cleared ? "bg-pursue/15 text-pursue" : "bg-risk/15 text-risk"}`}>
          {cleared ? "Cleared for work" : "Blocked"}
        </span>
      </div>

      {blockReason && <p className="text-sm text-risk">{blockReason}</p>}
      {cleared && expiringSoon.length > 0 && (
        <p className="text-sm text-review">
          Cleared, but chase a renewal now:{" "}
          {expiringSoon
            .map((e) => `${DOC_LABEL[e.docType]} runs out ${shortDate(e.expiresAt)}`)
            .join("; ")}
          .
        </p>
      )}

      {/* Required documents, in the order the gate checks them. */}
      <div className="divide-y divide-border">
        {REQUIRED_FOR_AWARD.map((type) => (
          <DocRow
            key={type}
            type={type}
            doc={latest.get(type)}
            busy={busy}
            rejecting={rejecting}
            reason={reason}
            setReason={setReason}
            setRejecting={setRejecting}
            onDecide={decide}
          />
        ))}
        {(["coi_auto", "license", "other"] as DocType[])
          .filter((t) => latest.has(t))
          .map((type) => (
            <DocRow
              key={type}
              type={type}
              doc={latest.get(type)}
              busy={busy}
              rejecting={rejecting}
              reason={reason}
              setReason={setReason}
              setRejecting={setRejecting}
              onDecide={decide}
            />
          ))}
      </div>

      {error && <p className="text-sm text-risk">{error}</p>}

      <div className="border-t border-border pt-4">
        <p className="text-xs leading-relaxed text-slate-500">
          {companyName} signs their own W-9. Send them a link and they can fill it in and sign it
          without making an account. Staff can file a certificate or a paper W-9 on their behalf,
          but nobody here can sign one for them.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={issueLink} disabled={busy === "link"}>
            {busy === "link" ? "Creating..." : link ? "Create a new link" : "Create paperwork link"}
          </button>
        </div>
        {link && (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-surface/60 p-3">
            <p className="break-all font-mono text-xs text-slate-700">{link.url}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  navigator.clipboard?.writeText(link.url).then(
                    () => setCopied(true),
                    () => setCopied(false)
                  );
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <span className="text-xs text-slate-500">
                Works for {link.ttlDays} days, then stops. Anyone holding it can sign for{" "}
                {companyName}, so send it to them and not to a group inbox.
              </span>
            </div>
          </div>
        )}
      </div>

      <OperatorFiling subId={subId} onFiled={() => router.refresh()} />

      {history.length > 0 && (
        <details className="border-t border-border pt-4">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Superseded documents ({history.length})
          </summary>
          <p className="mt-2 text-xs text-slate-500">
            Kept so we can prove what was on file on any given date. Never counted against the sub.
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            {history.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {DOC_LABEL[d.doc_type as DocType] ?? d.doc_type}
                  {d.created_at ? ` · filed ${shortDate(d.created_at)}` : ""}
                  {d.rejection_reason ? ` · ${d.rejection_reason}` : ""}
                </span>
                {d.storage_path && (
                  <a
                    href={`/api/files/${d.storage_path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Filing a document that arrived some other way: faxed by a broker, handed
 * over on paper, attached to an email.
 *
 * Includes W-9 in the list, and that is not a contradiction of the rule above.
 * A scanned W-9 the subcontractor already signed by hand is a real signed W-9
 * and belongs on file. What staff cannot do is create the signature, which is
 * why this posts a file and never a certification.
 */
function OperatorFiling({ subId, onFiled }: { subId: string; onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<DocType>("coi_general_liability");
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [carrier, setCarrier] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const FILEABLE: DocType[] = [
    "coi_general_liability",
    "coi_workers_comp",
    "coi_auto",
    "w9",
    "license",
    "other",
  ];

  async function submit() {
    if (!file) {
      setError("Choose a file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("doc_type", docType);
      body.set("file", file);
      if (expiresAt) body.set("expires_at", expiresAt);
      if (carrier.trim()) body.set("carrier", carrier.trim());
      if (policyNumber.trim()) body.set("policy_number", policyNumber.trim());

      const res = await fetch(`/api/subs/${subId}/documents`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That did not save.");
        return;
      }
      setOpen(false);
      setFile(null);
      setExpiresAt("");
      setCarrier("");
      setPolicyNumber("");
      onFiled();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="border-t border-border pt-4">
        <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
          File a document we received another way
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1 block">Document</span>
          <select
            className="input"
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
          >
            {FILEABLE.map((t) => (
              <option key={t} value={t}>
                {DOC_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1 block">
            Expires{docType.startsWith("coi_") && <span className="ml-1 font-normal text-risk">required</span>}
          </span>
          <input
            type="date"
            className="input"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
      </div>
      {docType.startsWith("coi_") && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1 block">Carrier</span>
            <input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </label>
          <label className="block">
            <span className="label mb-1 block">Policy number</span>
            <input
              className="input"
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="block">
        <span className="label mb-1 block">File</span>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx,image/*,application/pdf"
          className="input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <p className="text-xs text-slate-500">
        Filed as pending. It still has to be verified before it clears the gate, the same as
        anything the sub sends in themselves.
      </p>
      {error && <p className="text-sm text-risk">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn-primary text-xs" onClick={submit} disabled={busy || !file}>
          {busy ? "Filing..." : "File document"}
        </button>
        <button className="btn-ghost text-xs" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DocRow({
  type,
  doc,
  busy,
  rejecting,
  reason,
  setReason,
  setRejecting,
  onDecide,
}: {
  type: DocType;
  doc: PanelDoc | undefined;
  busy: string | null;
  rejecting: string | null;
  reason: string;
  setReason: (v: string) => void;
  setRejecting: (v: string | null) => void;
  onDecide: (docId: string, action: "verify" | "reject") => void;
}) {
  if (!doc) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <span className="text-sm text-slate-800">{DOC_LABEL[type]}</span>
        <span className="badge bg-slate-200 text-slate-700">Nothing on file</span>
      </div>
    );
  }

  const coverage =
    doc.coverage_cents == null ? null : currency(Number(doc.coverage_cents) / 100);
  const needsDecision = !doc.verified_at && doc.status !== "rejected";

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{DOC_LABEL[type]}</span>
            <span className={`badge ${STATUS_CLASS[doc.status] ?? "bg-slate-200 text-slate-700"}`}>
              {STATUS_LABEL[doc.status] ?? doc.status}
            </span>
            {doc.source === "subcontractor" && (
              <span className="badge bg-slate-200 text-slate-700" title="Sent in by the sub through their paperwork link.">
                From the sub
              </span>
            )}
          </div>

          {(() => {
            const details = [
              doc.expires_at ? `Expires ${shortDate(doc.expires_at)}` : null,
              doc.carrier,
              doc.policy_number ? `Policy ${doc.policy_number}` : null,
              coverage ? `${coverage} limit` : null,
            ].filter(Boolean);
            // A W-9 has no carrier, policy, or expiry, so the "nothing on
            // file" line would be wrong rather than merely unhelpful.
            if (details.length === 0 && type === "w9") return null;
            return (
              <p className="mt-1 text-xs text-slate-500">
                {details.join(" · ") || "No dates or policy details on file."}
              </p>
            );
          })()}

          {doc.signed_at && (
            <p className="mt-1 text-xs text-slate-500">
              Signed by {doc.signed_name} on {shortDate(doc.signed_at)}
              {doc.w9_legal_name ? ` as ${doc.w9_legal_name}` : ""}
              {doc.w9_tin_last4 && doc.w9_tin_type
                ? ` · ${maskedTin(doc.w9_tin_last4, doc.w9_tin_type as TinType)}`
                : ""}
            </p>
          )}
          {doc.rejection_reason && (
            <p className="mt-1 text-xs text-risk">{doc.rejection_reason}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {doc.storage_path && (
            <a
              href={`/api/files/${doc.storage_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost text-xs"
            >
              Open
            </a>
          )}
          {needsDecision && (
            <>
              <button
                className="btn-primary text-xs"
                onClick={() => onDecide(doc.id, "verify")}
                disabled={busy === doc.id}
              >
                {busy === doc.id ? "Saving..." : "Verify"}
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={() => setRejecting(rejecting === doc.id ? null : doc.id)}
                disabled={busy === doc.id}
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>

      {rejecting === doc.id && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-surface/60 p-3">
          <label className="block">
            <span className="label mb-1 block">What is wrong with it?</span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Names the wrong insured, limits are too low, page 2 is missing"
            />
          </label>
          <p className="text-xs text-slate-500">
            This is what the sub will be told, so write it as an instruction they can act on.
          </p>
          <div className="flex items-center gap-3">
            <button
              className="btn-primary text-xs"
              onClick={() => onDecide(doc.id, "reject")}
              disabled={busy === doc.id || reason.trim().length < 3}
            >
              Reject document
            </button>
            <button className="btn-ghost text-xs" onClick={() => setRejecting(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
