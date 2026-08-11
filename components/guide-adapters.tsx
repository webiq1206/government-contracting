"use client";

/**
 * In-panel action adapters for Guide Me: complete the step without sending
 * the operator on a scavenger hunt through Settings / Call Queue / etc.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { QuoteEntryForm } from "@/components/quote-entry-form";
import { CallWorkspace, type CallWorkspaceData } from "@/components/call-workspace";
import { TokenMultiSelect } from "@/components/token-multi-select";
import { NAICS_CODES } from "@/lib/naics";
import { US_SERVICE_AREAS } from "@/lib/us-states";
import { trackClientEvent } from "@/lib/client-analytics";
import { currency } from "@/lib/format";
import type { GuideAdapters, GuideStep } from "@/lib/domain/page-guide";
import type { CompanyProfileJson } from "@/lib/types";

function toCsv(arr?: string[] | null) {
  return (arr ?? []).join(", ");
}
function fromCsv(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function GuideStepActions({
  step,
  adapters,
  onHighlight,
  onDone,
  onClose,
}: {
  step: GuideStep;
  adapters: GuideAdapters;
  onHighlight: (target?: string) => void;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  if (step.kind === "triage" && step.opportunityId) {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton
          endpoint={`/api/opportunities/${step.opportunityId}/action`}
          body={{ action: "pursue" }}
          className="btn-success text-xs"
          onDone={() => void onDone()}
          toast={{ message: "Pursued. Analysis and pricing are running." }}
        >
          Pursue
        </ActionButton>
        <ActionButton
          endpoint={`/api/opportunities/${step.opportunityId}/action`}
          body={{ action: "dismiss" }}
          className="btn-danger text-xs"
          onDone={() => void onDone()}
          toast={{
            message: "Dismissed. It's archived, not deleted.",
            undo: {
              endpoint: `/api/opportunities/${step.opportunityId}/action`,
              body: { action: "restore" },
            },
          }}
        >
          Dismiss
        </ActionButton>
        <Link
          href={`/opportunity/${step.opportunityId}`}
          className="btn-ghost text-xs"
          onClick={onClose}
        >
          Open brief
        </Link>
      </div>
    );
  }

  if (step.kind === "outcome" && step.opportunityId) {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton
          endpoint={`/api/opportunities/${step.opportunityId}/outcome`}
          body={{ outcome: "won" }}
          className="btn-success text-xs"
          confirm="Mark as WON and create the contract?"
          onDone={() => void onDone()}
        >
          Mark won
        </ActionButton>
        <ActionButton
          endpoint={`/api/opportunities/${step.opportunityId}/outcome`}
          body={{ outcome: "lost" }}
          className="btn-danger text-xs"
          confirm="Mark this bid as lost?"
          onDone={() => void onDone()}
        >
          Mark lost
        </ActionButton>
      </div>
    );
  }

  if (step.kind === "resume-automation") {
    return (
      <ActionButton
        endpoint="/api/automation"
        body={{ paused: false }}
        className="btn-primary text-xs"
        onDone={() => void onDone()}
        toast={{ message: "Automation resumed. Brost Co will pick up where it left off." }}
      >
        Resume automation
      </ActionButton>
    );
  }

  if (step.kind === "setup-identity") {
    return <IdentityFields onSaved={onDone} />;
  }

  if (step.kind === "setup-naics") {
    return <ProfileArrayFields field="naics" onSaved={onDone} />;
  }

  if (step.kind === "setup-areas") {
    return <ProfileArrayFields field="areas" onSaved={onDone} />;
  }

  if (step.kind === "review-quote" && adapters.quoteReview) {
    return <QuoteReviewAdapter item={adapters.quoteReview} onDone={onDone} onClose={onClose} />;
  }

  if (step.kind === "upload-document" && (adapters.upload || step.opportunityId)) {
    return (
      <DocumentUploadAdapter
        opportunityId={adapters.upload?.opportunityId || step.opportunityId!}
        onDone={onDone}
      />
    );
  }

  if (step.kind === "submit-package" && (adapters.package || step.opportunityId)) {
    return (
      <SubmitPackageAdapter
        pack={
          adapters.package ?? {
            opportunityId: step.opportunityId!,
            packageReady: null,
            blockers: [],
            submitted: false,
          }
        }
        onDone={onDone}
        onClose={onClose}
      />
    );
  }

  if (step.kind === "enter-quote") {
    const quote = adapters.quote;
    const oppId = quote?.opportunityId || step.opportunityId;
    if (!oppId) {
      return step.href ? (
        <Link href={step.href} className="btn-primary text-xs" onClick={onClose}>
          {step.cta || "Open opportunity"}
        </Link>
      ) : null;
    }
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">Enter a quote here. Bid Builder re-prices when you save.</p>
        <QuoteEntryForm
          opportunityId={oppId}
          subs={quote?.subs ?? []}
          layout="stacked"
          onSaved={() => void onDone()}
        />
      </div>
    );
  }

  if (step.kind === "open-call") {
    if (step.adapter === "followUp" && adapters.followUp) {
      const fu = adapters.followUp;
      return (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{fu.companyName}</span>
            {fu.trade ? ` · ${fu.trade}` : ""}
            {fu.opportunityTitle ? ` on ${fu.opportunityTitle}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {fu.phone && (
              <a href={`tel:${fu.phone}`} className="btn-primary text-xs">
                Call {fu.phone}
              </a>
            )}
            <Link
              href={`/opportunity/${fu.opportunityId}`}
              className="btn-secondary text-xs"
              onClick={onClose}
            >
              Open opportunity
            </Link>
            <Link
              href={`/subs/${fu.subcontractorId}`}
              className="btn-ghost text-xs"
              onClick={onClose}
            >
              Sub record
            </Link>
          </div>
        </div>
      );
    }
    if (adapters.call) {
      return (
        <GuideCallLauncher
          cardId={adapters.call.cardId}
          companyName={adapters.call.companyName}
          opportunityTitle={adapters.call.opportunityTitle}
          onCloseGuide={onClose}
          onDone={onDone}
        />
      );
    }
    return (
      <Link href="/call-queue" className="btn-primary text-xs" onClick={onClose}>
        Open Call Queue
      </Link>
    );
  }

  if (step.kind === "compliance-update" && adapters.compliance) {
    return <ComplianceAdapter item={adapters.compliance} onDone={onDone} />;
  }

  if (step.kind === "approve-weights") {
    if (!adapters.weights) {
      return (
        <Link href="/today" className="btn-primary text-xs" onClick={onClose}>
          Open Today approvals
        </Link>
      );
    }
    const w = adapters.weights;
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-700">
          Scoring weights proposal v{w.version}
          {w.rationale ? `: ${w.rationale}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            endpoint={`/api/scoring-weights/${w.id}/approve`}
            body={{ action: "approve" }}
            className="btn-success text-xs"
            onDone={() => void onDone()}
            toast={{ message: "Weights approved. New scoring uses this version." }}
          >
            Approve
          </ActionButton>
          <ActionButton
            endpoint={`/api/scoring-weights/${w.id}/approve`}
            body={{ action: "reject" }}
            className="btn-danger text-xs"
            onDone={() => void onDone()}
            toast={{ message: "Proposal rejected." }}
          >
            Reject
          </ActionButton>
        </div>
      </div>
    );
  }

  if (step.kind === "edit-sub-contact" && adapters.subContact) {
    return <SubContactAdapter sub={adapters.subContact} onSaved={onDone} />;
  }

  if (step.kind === "highlight" && step.target) {
    return (
      <button
        type="button"
        className="btn-primary text-xs"
        onClick={() => {
          onHighlight(step.target);
          onClose();
        }}
      >
        {step.cta || "Show me where"}
      </button>
    );
  }

  if (step.href) {
    if (step.target || step.href.startsWith("#")) {
      const target = step.target || step.href.replace(/^#/, "");
      return (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              onHighlight(target);
              onClose();
            }}
          >
            {step.cta || "Show me where"}
          </button>
          {!step.href.startsWith("#") && (
            <Link href={step.href} className="btn-ghost text-xs" onClick={onClose}>
              Open link
            </Link>
          )}
        </div>
      );
    }
    return (
      <Link href={step.href} className="btn-primary text-xs" onClick={onClose}>
        {step.cta || "Continue"}
      </Link>
    );
  }

  if (step.cta) return <p className="text-xs text-slate-500">{step.cta}</p>;
  return null;
}

function GuideCallLauncher({
  cardId,
  companyName,
  opportunityTitle,
  onCloseGuide,
  onDone,
}: {
  cardId: string;
  companyName: string;
  opportunityTitle: string | null;
  onCloseGuide: () => void;
  onDone: () => Promise<void>;
}) {
  const [data, setData] = useState<CallWorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-cards/${cardId}/workspace`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load call card");
      setData(body);
      onCloseGuide();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm text-slate-700">
          Next: <span className="font-medium">{companyName}</span>
          {opportunityTitle ? ` · ${opportunityTitle}` : ""}
        </p>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={loading}
          onClick={() => void openWorkspace()}
        >
          {loading ? "Loading…" : "Start call workspace"}
        </button>
        {error && <p className="text-xs text-risk">{error}</p>}
        <Link href={`/call-queue?open=${cardId}`} className="ml-2 text-xs text-slate-500 underline-offset-2 hover:underline">
          Open in Call Queue
        </Link>
      </div>
      {data && (
        <CallWorkspace
          data={data}
          onClose={() => {
            setData(null);
            void onDone();
          }}
        />
      )}
    </>
  );
}

function ComplianceAdapter({
  item,
  onDone,
}: {
  item: NonNullable<GuideAdapters["compliance"]>;
  onDone: () => Promise<void>;
}) {
  const [due, setDue] = useState(item.dueAt ? item.dueAt.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra?: { status_override?: string }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          due_at_override: due || null,
          ...extra,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      await onDone();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{item.label}</p>
      <p className="text-xs text-slate-500">Status: {item.status}</p>
      <label className="block text-xs text-slate-600">
        Renewal date
        <input
          type="date"
          className="input mt-1"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-risk">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save date"}
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={saving}
          onClick={() => void save({ status_override: "resolved" })}
        >
          Mark resolved
        </button>
      </div>
    </div>
  );
}

function SubContactAdapter({
  sub,
  onSaved,
}: {
  sub: NonNullable<GuideAdapters["subContact"]>;
  onSaved: () => Promise<void>;
}) {
  const [email, setEmail] = useState(sub.email ?? "");
  const [phone, setPhone] = useState(sub.phone ?? "");
  const [website, setWebsite] = useState(sub.website ?? "");
  const [ownerName, setOwnerName] = useState(sub.ownerName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/subs/${sub.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          phone,
          website,
          owner_name: ownerName,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      await onSaved();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{sub.companyName}</p>
      <label className="block text-xs text-slate-600">
        Email
        <input className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-600">
        Phone
        <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-600">
        Website
        <input className="input mt-1" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-600">
        Contact name
        <input
          className="input mt-1"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-risk">{error}</p>}
      <button
        type="button"
        className="btn-primary text-xs"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save contact"}
      </button>
    </div>
  );
}

function QuoteReviewAdapter({
  item,
  onDone,
  onClose,
}: {
  item: NonNullable<GuideAdapters["quoteReview"]>;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-700">
        <span className="font-medium">{item.companyName ?? "Subcontractor"}</span>
        {item.trade ? ` · ${item.trade}` : ""}
        {item.quoteAmount != null ? ` · ${currency(item.quoteAmount)}` : ""}
      </p>
      <p className="text-xs text-slate-500">
        This price looks unusual versus comps. Accept it as usable, or open the opportunity to
        re-enter a corrected quote.
      </p>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          endpoint={`/api/quotes/${item.quoteId}/review`}
          body={{ action: "accept" }}
          className="btn-success text-xs"
          onDone={() => {
            trackClientEvent("guide_action_complete", {
              kind: "review-quote",
              action: "accept",
            });
            void onDone();
          }}
          toast={{ message: "Quote accepted. It will no longer flag as out of range." }}
        >
          Accept as-is
        </ActionButton>
        <Link
          href={`/opportunity/${item.opportunityId}?guide=1&guideStep=today-quotes#quotes`}
          className="btn-secondary text-xs"
          onClick={onClose}
        >
          Re-enter quote
        </Link>
      </div>
    </div>
  );
}

function DocumentUploadAdapter({
  opportunityId,
  onDone,
}: {
  opportunityId: string;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (name.trim()) fd.set("name", name.trim());
      const res = await fetch(`/api/opportunities/${opportunityId}/documents`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      trackClientEvent("guide_action_complete", { kind: "upload-document" });
      await onDone();
    } catch {
      setError("Upload failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-600">
        Label (optional)
        <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-600">
        File
        <input
          type="file"
          className="mt-1 block w-full text-xs"
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="text-xs text-risk">{error}</p>}
      <button
        type="button"
        className="btn-primary text-xs"
        disabled={saving}
        onClick={() => void upload()}
      >
        {saving ? "Uploading…" : "Upload document"}
      </button>
    </div>
  );
}

function SubmitPackageAdapter({
  pack,
  onDone,
  onClose,
}: {
  pack: NonNullable<GuideAdapters["package"]>;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  if (pack.submitted) {
    return <p className="text-sm text-slate-600">This package is already submitted.</p>;
  }
  return (
    <div className="space-y-2">
      {pack.blockers.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          {pack.blockers.slice(0, 4).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          endpoint={`/api/opportunities/${pack.opportunityId}/submit`}
          body={{ force: false }}
          className="btn-primary text-xs"
          confirm="Submit this bid package?"
          onDone={() => {
            trackClientEvent("guide_action_complete", { kind: "submit-package" });
            void onDone();
          }}
          toast={{ message: "Submitted. Outcome tracking is now active." }}
        >
          {pack.packageReady ? "Submit package" : "Try submit"}
        </ActionButton>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            onClose();
            document.getElementById("submission")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          Open full checklist
        </button>
      </div>
    </div>
  );
}

function ProfileArrayFields({
  field,
  onSaved,
}: {
  field: "naics" | "areas";
  onSaved: () => Promise<void>;
}) {
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profileRef = useRef<CompanyProfileJson | null>(null);

  const options = useMemo(
    () =>
      field === "naics"
        ? NAICS_CODES.map((n) => ({ value: n.code, label: `${n.code} · ${n.title}` }))
        : US_SERVICE_AREAS.map((s) => ({ value: s, label: s })),
    [field]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile");
        const data = (await res.json()) as { profile?: { profile_json?: CompanyProfileJson } };
        const json = data.profile?.profile_json ?? null;
        if (cancelled) return;
        profileRef.current = json;
        setCsv(toCsv(field === "naics" ? json?.naics_codes : json?.service_areas));
      } catch {
        if (!cancelled) setError("Could not load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [field]);

  async function save() {
    if (!profileRef.current) {
      setError("Open Company profile if this save fails.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: CompanyProfileJson = {
        ...profileRef.current,
        ...(field === "naics"
          ? { naics_codes: fromCsv(csv) }
          : { service_areas: fromCsv(csv) }),
      };
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      trackClientEvent("guide_action_complete", { kind: `setup-${field}` });
      await onSaved();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-xs text-slate-500">Loading fields…</p>;

  return (
    <div className="space-y-2">
      <TokenMultiSelect
        value={csv}
        onChange={setCsv}
        options={options}
        allowCustom={field === "areas"}
        placeholder={field === "naics" ? "Search NAICS…" : "Search states…"}
      />
      {error && <p className="text-xs text-risk">{error}</p>}
      <button
        type="button"
        className="btn-primary text-xs"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : field === "naics" ? "Save NAICS" : "Save service areas"}
      </button>
    </div>
  );
}

export function IdentityFields({ onSaved }: { onSaved: () => Promise<void> }) {
  const [uei, setUei] = useState("");
  const [cage, setCage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profileRef = useRef<CompanyProfileJson | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile");
        const data = (await res.json()) as { profile?: { profile_json?: CompanyProfileJson } };
        const json = data.profile?.profile_json ?? null;
        if (cancelled) return;
        profileRef.current = json;
        setUei(json?.uei ?? "");
        setCage(json?.cage_code ?? "");
      } catch {
        if (!cancelled) setError("Could not load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!profileRef.current) {
      setError("Open Company profile to finish setup if this save fails.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: CompanyProfileJson = {
        ...profileRef.current,
        uei: uei.trim(),
        cage_code: cage.trim(),
      };
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      await onSaved();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-xs text-slate-500">Loading fields…</p>;

  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-600">
        UEI
        <input
          className="input mt-1"
          value={uei}
          onChange={(e) => setUei(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="block text-xs text-slate-600">
        CAGE code
        <input
          className="input mt-1"
          value={cage}
          onChange={(e) => setCage(e.target.value)}
          autoComplete="off"
        />
      </label>
      {error && <p className="text-xs text-risk">{error}</p>}
      <button
        type="button"
        className="btn-primary text-xs"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save identifiers"}
      </button>
      <Link
        href="/settings/profile"
        className="ml-2 text-xs text-slate-500 underline-offset-2 hover:underline"
      >
        Open full profile
      </Link>
    </div>
  );
}
