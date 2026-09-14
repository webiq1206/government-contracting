"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UnsavedGuard } from "./unsaved-guard";
import {
  IMPORTED_FIELD_KEYS,
  PROVENANCE_LABEL,
  type FieldProvenance,
  type ImportedFieldKey,
  type ImportedFields,
  type DuplicateMatch,
} from "@/lib/domain/solicitation-import";

type Preview = {
  url: string;
  kind: "sam_notice" | "web";
  status: "read" | "login_required" | "unreachable" | "not_enough";
  message: string;
  fields: ImportedFields;
  provenance: Partial<Record<ImportedFieldKey, FieldProvenance>>;
  samNoticeId: string | null;
  duplicates: DuplicateMatch[];
};

type Values = Record<ImportedFieldKey, string>;

const EMPTY: Values = {
  title: "",
  agency: "",
  solicitation_number: "",
  description: "",
  deadline: "",
  posted_at: "",
  naics_code: "",
  set_aside_type: "",
  location_text: "",
};

const LABEL: Record<ImportedFieldKey, string> = {
  title: "Title",
  agency: "Issuing organization",
  solicitation_number: "Solicitation number",
  description: "What the work is",
  deadline: "Response deadline",
  posted_at: "Posted on",
  naics_code: "NAICS code",
  set_aside_type: "Set-aside",
  location_text: "Place of performance",
};

const MAX_FILE_BYTES = 12 * 1024 * 1024;

function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInput(iso: string): string {
  return toLocalInput(iso).slice(0, 10);
}

function ProvenanceTag({ value }: { value: FieldProvenance | undefined }) {
  if (!value) return null;
  const tone =
    value === "retrieved"
      ? "bg-pursue-soft text-pursue-strong"
      : value === "inferred"
        ? "bg-review/15 text-review"
        : "bg-surface-raised text-muted-foreground";
  return <span className={`badge ${tone}`}>{PROVENANCE_LABEL[value]}</span>;
}

export function AddSolicitationForm({ canSave }: { canSave: boolean }) {
  const router = useRouter();
  const pending = useRef(false);
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [provenance, setProvenance] = useState<Partial<Record<ImportedFieldKey, FieldProvenance>>>({});
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [force, setForce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const dirty = Object.values(values).some((v) => v.trim() !== "") || files.length > 0;
  const method: "url" | "upload" | "manual" = preview ? "url" : files.length > 0 ? "upload" : "manual";

  function setField(key: ImportedFieldKey, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
    setProvenance((p) => ({ ...p, [key]: "entered" }));
  }

  async function fetchDetails() {
    if (!url.trim() || fetching) return;
    setFetching(true);
    setFetchError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/opportunities/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json().catch(() => ({}))) as Preview & { error?: string };
      if (!res.ok) {
        setFetchError(data.error ?? "That link could not be read.");
        return;
      }
      setPreview(data);
      setDuplicates(data.duplicates ?? []);
      const next: Values = { ...EMPTY };
      for (const key of IMPORTED_FIELD_KEYS) {
        const v = data.fields[key];
        if (!v) continue;
        next[key] = key === "deadline" ? toLocalInput(v) : key === "posted_at" ? toDateInput(v) : v;
      }
      setValues(next);
      setProvenance(data.provenance ?? {});
      setAttachments(data.fields.attachments ?? []);
    } catch {
      setFetchError("The link took too long to read. Try again, upload the documents, or enter the details by hand.");
    } finally {
      setFetching(false);
    }
  }

  async function checkDuplicates(): Promise<DuplicateMatch[]> {
    try {
      const res = await fetch("/api/opportunities/import/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: values.title, solicitation_number: values.solicitation_number, url: preview?.url ?? null }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { duplicates?: DuplicateMatch[] };
      return data.duplicates ?? [];
    } catch {
      return [];
    }
  }

  async function save() {
    if (pending.current || !canSave) return;
    if (!values.title.trim()) {
      setSaveError("Give it a title first.");
      return;
    }
    pending.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (!force) {
        const dups = await checkDuplicates();
        if (dups.length > 0) {
          setDuplicates(dups);
          setSaveError("This looks like something already in your opportunities. Open the existing record, or add it anyway.");
          return;
        }
      }
      const fields: Partial<ImportedFields> = {};
      for (const key of IMPORTED_FIELD_KEYS) {
        const v = values[key].trim();
        if (!v) continue;
        fields[key] = key === "deadline" || key === "posted_at" ? new Date(v).toISOString() : v;
      }
      const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          url: preview?.url ?? null,
          samNoticeId: preview?.samNoticeId ?? null,
          fields,
          provenance,
          attachments,
          force,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; duplicates?: DuplicateMatch[] };
      if (res.status === 409 && data.duplicates) {
        setDuplicates(data.duplicates);
        setSaveError("This looks like something already in your opportunities. Open the existing record, or add it anyway.");
        return;
      }
      if (!res.ok || !data.id) {
        setSaveError(data.error ?? "That did not save.");
        return;
      }
      // Documents go up one at a time so a failure names the file.
      const failed: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(`Uploading ${file.name} (${i + 1} of ${files.length})`);
        const form = new FormData();
        form.append("file", file);
        form.append("analyze", "1");
        try {
          const up = await fetch(`/api/opportunities/${data.id}/documents`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
          if (!up.ok) failed.push(file.name);
        } catch {
          failed.push(file.name);
        }
      }
      setUploadProgress(null);
      const query = failed.length > 0 ? `?added=1&upload_failed=${encodeURIComponent(failed.join(", "))}` : "?added=1";
      router.push(`/opportunity/${data.id}${query}`);
    } catch {
      setSaveError("The save was not confirmed. Check your opportunities before trying again. Your entries are still here.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [...files];
    const rejected: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_BYTES || f.size === 0) {
        rejected.push(f.name);
        continue;
      }
      if (!/\.(pdf|docx?|png|jpe?g)$/i.test(f.name)) {
        rejected.push(f.name);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next.slice(0, 10));
    setSaveError(rejected.length > 0 ? `Not added: ${rejected.join(", ")}. Files must be PDF, Word, PNG or JPEG under 12 MB.` : null);
  }

  return (
    <div className="space-y-6">
      <UnsavedGuard when={dirty && !saving} />

      <section className="card space-y-3">
        <h2 className="font-display text-lg font-semibold">Start from a link</h2>
        <p className="text-sm text-muted-foreground">
          A SAM.gov notice, a state or city procurement page, or a PDF link. Brost Co reads what the page states and marks anything it only guessed.
        </p>
        <div className="search-row">
          <label className="sr-only" htmlFor="import-url">Solicitation link</label>
          <input
            id="import-url"
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://sam.gov/opp/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void fetchDetails();
              }
            }}
          />
          <button type="button" className="btn-secondary min-h-11 shrink-0" disabled={fetching || !url.trim()} onClick={() => void fetchDetails()}>
            {fetching ? "Reading" : "Read the link"}
          </button>
        </div>
        {fetchError && <p role="alert" className="text-sm text-risk">{fetchError}</p>}
        {preview && (
          <p role="status" className={`text-sm ${preview.status === "read" ? "text-foreground" : "text-review"}`}>
            {preview.message}
          </p>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-display text-lg font-semibold">Or upload the documents</h2>
        <p className="text-sm text-muted-foreground">
          The solicitation, statement of work, drawings, amendments. They are read after saving, and the analysis and requirements come from them.
        </p>
        <label className="btn-ghost inline-flex min-h-11 cursor-pointer items-center" htmlFor="import-files">
          Choose files
          <input id="import-files" type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => addFiles(e.target.files)} />
        </label>
        {files.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{f.name}</span>
                <button type="button" className="btn-ghost min-h-11 text-xs" onClick={() => setFiles(files.filter((x) => x !== f))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-display text-lg font-semibold">The details</h2>
          <p className="text-sm text-muted-foreground">
            Only the title is required. Anything the source stated is marked, so you can see what to check.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {IMPORTED_FIELD_KEYS.map((key) => {
            const wide = key === "title" || key === "description";
            const type = key === "deadline" ? "datetime-local" : key === "posted_at" ? "date" : "text";
            return (
              <div key={key} className={wide ? "sm:col-span-2" : ""}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="label" htmlFor={`f-${key}`}>
                    {LABEL[key]}
                    {key === "title" ? " (required)" : ""}
                  </label>
                  <ProvenanceTag value={provenance[key]} />
                </div>
                {key === "description" ? (
                  <textarea id={`f-${key}`} className="input min-h-32" value={values[key]} onChange={(e) => setField(key, e.target.value)} />
                ) : (
                  <input
                    id={`f-${key}`}
                    className="input"
                    type={type}
                    inputMode={key === "naics_code" ? "numeric" : undefined}
                    value={values[key]}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
        {attachments.length > 0 && (
          <div>
            <p className="label">Documents linked from the source</p>
            <ul className="mt-1 space-y-1 text-sm">
              {attachments.map((a) => (
                <li key={a.url} className="flex items-center justify-between gap-3">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate underline">{a.name}</a>
                  <button type="button" className="btn-ghost min-h-11 text-xs" onClick={() => setAttachments(attachments.filter((x) => x.url !== a.url))}>
                    Leave out
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">These are fetched and read after saving.</p>
          </div>
        )}
      </section>

      {duplicates.length > 0 && (
        <section className="rounded-md border border-review/40 bg-review/10 p-4" role="status">
          <p className="font-medium">Already here?</p>
          <ul className="mt-2 space-y-2 text-sm">
            {duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  {d.title ?? "Untitled"}{" "}
                  <span className="text-muted-foreground">
                    ({d.reason === "similar_title" ? "similar title" : d.reason === "source_id" ? "same notice" : d.reason === "source_url" ? "same link" : "same solicitation number"}, {d.status === "open" ? d.stage.replace(/_/g, " ") : d.status})
                  </span>
                </span>
                <Link href={`/opportunity/${d.id}`} className="btn-ghost min-h-11 text-xs">Open it</Link>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            It is different. Add it anyway.
          </label>
        </section>
      )}

      {saveError && <p role="alert" className="text-sm text-risk">{saveError}</p>}
      {uploadProgress && <p role="status" className="text-sm text-muted-foreground">{uploadProgress}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary min-h-11" disabled={!canSave || saving || !values.title.trim()} onClick={() => void save()}>
          {saving ? "Saving" : "Add to opportunities"}
        </button>
        <Link href="/pipeline" className="btn-ghost min-h-11">Cancel</Link>
        <p className="text-xs text-muted-foreground">
          {method === "url" && preview?.kind === "sam_notice"
            ? "Saved as a SAM.gov opportunity and checked for changes like the rest."
            : "Saved once from what you provide. The source is kept so you can verify it; it is not watched for changes."}
        </p>
      </div>
    </div>
  );
}
