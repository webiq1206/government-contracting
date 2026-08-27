"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentDisplay, InventoryCoverage } from "@/lib/domain/document-inventory";

/**
 * Every source document on this opportunity, and what became of each one.
 *
 * The panel this replaces listed a filename, a kind, and a link. That is
 * enough to find a file and nowhere near enough to answer the question an
 * operator actually has, which is whether anything in this bid has gone
 * unread. A document that downloaded cleanly and was then dropped for want of
 * room in the analysis looked exactly like one read cover to cover.
 *
 * So the rule here is that a document with a problem stays visible, at the
 * top, with a sentence saying what the problem costs. Sorting it alphabetically
 * would bury the one file nobody read under thirty that are fine, and hiding
 * it behind a filter would be worse.
 */
export function DocumentInventoryPanel({
  documents,
  coverage,
  canDecide,
  canRunAgents,
}: {
  documents: DocumentDisplay[];
  /**
   * The reconciliation, from `inventoryCoverage`.
   *
   * Passed in rather than counted here on purpose. A panel that counts its own
   * blockers and a completeness check that counts them separately are two
   * numbers that will disagree eventually, and the one on the screen is the
   * one people believe.
   */
  coverage: InventoryCoverage;
  /** Review, exclude and supersede: judgements about whether the bid is sound. */
  canDecide: boolean;
  /** Ask for another read. */
  canRunAgents: boolean;
}) {
  return (
    <div className="card scroll-mt-editorial" id="attachments" data-guide-target="attachments">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">
          Documents · <span className="num">{documents.length}</span>
        </p>
        <p
          className={`text-xs ${coverage.complete ? "text-muted-foreground" : "font-medium text-risk"}`}
        >
          {coverage.summary}
        </p>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No documents collected yet. The next run of the solicitation analyst will attach the
          originals from the notice.
        </p>
      ) : (
        <>
          {/* Desktop: the full manifest, because on a wide screen there is room
              for every column and hiding one behind a click helps nobody. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Document</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Pages</th>
                  <th className="py-2 pr-3 font-medium">Read</th>
                  <th className="py-2 pr-3 font-medium">Relevance</th>
                  <th className="py-2 pr-3 font-medium">Last verified</th>
                  <th className="py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map((d) => (
                  <Row key={d.id} doc={d} canDecide={canDecide} canRunAgents={canRunAgents} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per document, the manifest folded away. The
              problem sentence is never folded: it is the reason to look. */}
          <ul className="divide-y divide-border md:hidden">
            {documents.map((d) => (
              <Card key={d.id} doc={d} canDecide={canDecide} canRunAgents={canRunAgents} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StateBadge({ doc }: { doc: DocumentDisplay }) {
  const tone =
    doc.attention === "blocker"
      ? "bg-risk/15 text-risk"
      : doc.attention === "watch"
        ? "bg-review/15 text-review"
        : "bg-pursue/10 text-pursue";
  return <span className={`badge ${tone}`}>{doc.extractionLabel}</span>;
}

function OpenLink({ doc }: { doc: DocumentDisplay }) {
  if (!doc.storagePath) {
    // A row with no bytes is not a broken link to offer, it is a fact to state.
    return <span className="text-xs text-muted-foreground">Not stored</span>;
  }
  return (
    <a
      className="text-xs underline underline-offset-2 hover:text-foreground"
      href={`/api/documents/${doc.id}/open`}
      target="_blank"
      rel="noreferrer"
    >
      Open
    </a>
  );
}

/**
 * The document itself, in the page, without leaving it.
 *
 * A federal solicitation runs to hundreds of pages across a dozen files, and
 * checking one extracted requirement against its source used to mean opening
 * a new tab, finding the page, reading a paragraph and coming back. Doing that
 * forty times is why nobody does it, and a checklist nobody checks is a
 * checklist that gets trusted more than it has earned.
 *
 * Rendered only for formats a browser actually renders, and the refusal says
 * which of the two reasons applies. "Nothing was stored for this row" and
 * "your browser will not render a Word document" are different facts and lead
 * to different next steps.
 *
 * Loaded only when opened. Forty iframes mounted at once on a page that also
 * holds the brief is a page nobody can scroll.
 */
function Preview({ doc }: { doc: DocumentDisplay }) {
  const [open, setOpen] = useState(false);
  const src = `/api/documents/${doc.id}/open`;

  if (doc.preview === "none") {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={
          doc.storagePath
            ? "A browser will not render this format. Open it to read it."
            : "Nothing was stored for this row, so there is nothing to show."
        }
      >
        No preview
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="text-xs underline underline-offset-2"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide preview" : "Preview"}
      </button>
      {open && (
        <div className="mt-2 w-full overflow-hidden rounded-md border border-border bg-surface-raised">
          {doc.preview === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={`Preview of ${doc.name}`} className="max-h-[70vh] w-full object-contain" />
          ) : (
            <iframe
              src={src}
              title={`Preview of ${doc.name}`}
              className="h-[60vh] max-h-[70vh] w-full"
            />
          )}
          <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
            {/*
              The preview is the file, not the extraction. Saying so matters
              on exactly the documents this feature exists for: a scan renders
              perfectly and was still read by nobody.
            */}
            This is the file as it arrived. Whether anything in it was read is the state above.
          </p>
        </div>
      )}
    </>
  );
}

function Meta({ doc }: { doc: DocumentDisplay }) {
  const bits = [
    doc.version > 1 ? `Version ${doc.version}` : null,
    doc.amendmentNumber !== null ? `Amendment ${doc.amendmentNumber}` : null,
    doc.ocrLabel,
    doc.accessLabel && doc.accessState !== "available" ? doc.accessLabel : null,
    doc.sourceSystem,
    doc.disposition !== "delivered" ? doc.dispositionLabel : null,
  ].filter(Boolean);
  return bits.length > 0 ? (
    <p className="mt-0.5 text-xs text-muted-foreground">{bits.join(" · ")}</p>
  ) : null;
}

function ReviewMark({ doc }: { doc: DocumentDisplay }) {
  if (!doc.reviewedBy) return <span className="text-xs text-muted-foreground">Not reviewed</span>;
  return (
    <span className="text-xs text-muted-foreground" title={doc.reviewNote ?? undefined}>
      {doc.reviewedBy}
      {doc.reviewedAt ? ` · ${doc.reviewedAt.toLocaleDateString()}` : ""}
    </span>
  );
}

function Row({
  doc,
  canDecide,
  canRunAgents,
}: {
  doc: DocumentDisplay;
  canDecide: boolean;
  canRunAgents: boolean;
}) {
  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <p className="font-medium text-foreground">{doc.name}</p>
        <Meta doc={doc} />
        {doc.problem && (
          <p
            className={`mt-1 text-xs ${doc.attention === "blocker" ? "text-risk" : "text-muted-foreground"}`}
          >
            {doc.problem}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <OpenLink doc={doc} />
          <Preview doc={doc} />
          <Actions doc={doc} canDecide={canDecide} canRunAgents={canRunAgents} />
        </div>
      </td>
      <td className="py-2 pr-3 text-muted-foreground">{doc.classLabel}</td>
      {/* Unknown is not zero. "Not counted" says nobody counted; "0" would say
          the document has no pages, which is a different and false claim. */}
      <td className="py-2 pr-3 text-muted-foreground">
        {doc.pageCount === null ? (
          "Not counted"
        ) : (
          <span className="num">{doc.pageCount}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <StateBadge doc={doc} />
      </td>
      <td className="py-2 pr-3 text-muted-foreground">{doc.relevanceLabel}</td>
      <td className="py-2 pr-3 text-muted-foreground">
        {doc.lastVerifiedAt ? doc.lastVerifiedAt.toLocaleDateString() : "Never"}
      </td>
      <td className="py-2">
        <ReviewMark doc={doc} />
      </td>
    </tr>
  );
}

function Card({
  doc,
  canDecide,
  canRunAgents,
}: {
  doc: DocumentDisplay;
  canDecide: boolean;
  canRunAgents: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{doc.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{doc.classLabel}</p>
        </div>
        <StateBadge doc={doc} />
      </div>
      {/* Never folded away. A problem behind a tap is a problem nobody reads. */}
      {doc.problem && (
        <p
          className={`mt-1 text-xs ${doc.attention === "blocker" ? "text-risk" : "text-muted-foreground"}`}
        >
          {doc.problem}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <OpenLink doc={doc} />
        <Preview doc={doc} />
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide details" : "Details"}
        </button>
        <Actions doc={doc} canDecide={canDecide} canRunAgents={canRunAgents} />
      </div>
      {open && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Pages</dt>
          <dd className="num">{doc.pageCount ?? "Not counted"}</dd>
          <dt>Relevance</dt>
          <dd>{doc.relevanceLabel}</dd>
          <dt>Disposition</dt>
          <dd>{doc.dispositionLabel}</dd>
          {doc.ocrLabel && (
            <>
              <dt>Transcription</dt>
              <dd>{doc.ocrLabel}</dd>
            </>
          )}
          {doc.accessLabel && (
            <>
              <dt>Source</dt>
              <dd>{doc.accessLabel}</dd>
            </>
          )}
          <dt>Version</dt>
          <dd className="num">{doc.version}</dd>
          <dt>Last verified</dt>
          <dd>{doc.lastVerifiedAt ? doc.lastVerifiedAt.toLocaleDateString() : "Never"}</dd>
          <dt>Review</dt>
          <dd>
            <ReviewMark doc={doc} />
          </dd>
        </dl>
      )}
    </li>
  );
}

/**
 * The three things a person can do about a document, offered only when they
 * would change something.
 *
 * "Try again" is hidden on a document that read fine, because re-reading a
 * document that is already read is a button that spends several minutes to
 * change nothing. It says what it really does: the whole solicitation is
 * re-analysed, not this one file, and there is no per-file extraction path to
 * pretend otherwise about.
 */
function Actions({
  doc,
  canDecide,
  canRunAgents,
}: {
  doc: DocumentDisplay;
  canDecide: boolean;
  canRunAgents: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"review" | "exclude" | "replace" | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const send = async (url: string, init?: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(body.error ?? "That did not work. Try again in a moment.");
        return;
      }
      setAsking(null);
      setNote("");
      setFile(null);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const patch = (payload: Record<string, unknown>) =>
    send(`/api/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  const retryable = doc.attention === "blocker" && doc.disposition !== "excluded";

  return (
    <>
      {canRunAgents && retryable && (
        <button
          type="button"
          className="text-xs underline underline-offset-2 disabled:opacity-50"
          disabled={busy}
          onClick={() => send(`/api/documents/${doc.id}/retry`, { method: "POST" })}
        >
          Read it again
        </button>
      )}
      {canDecide && !doc.reviewedBy && (
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setAsking(asking === "review" ? null : "review")}
        >
          I have read this
        </button>
      )}
      {canDecide && doc.disposition !== "excluded" && (
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setAsking(asking === "exclude" ? null : "exclude")}
        >
          Not relevant
        </button>
      )}
      {/*
        Offered on the documents that cannot be read, which is the only case
        it helps. "Read it again" re-runs the analysis over the same bytes and
        they fail the same way; a working copy is the thing that fixes an
        unreadable scan, and until now there was nowhere to put one.
      */}
      {canDecide && !doc.supersededBy && doc.attention === "blocker" && (
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setAsking(asking === "replace" ? null : "replace")}
        >
          Upload a working copy
        </button>
      )}
      {asking === "replace" && (
        <form
          className="mt-2 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file || !note.trim()) return;
            const body = new FormData();
            body.append("file", file);
            body.append("note", note.trim());
            void send(`/api/documents/${doc.id}/replace`, { method: "POST", body });
          }}
        >
          <p className="text-xs text-muted-foreground">
            {/*
              What happens, before it happens. Superseding is not obvious from
              a file picker, and an operator who expected a second attachment
              and got their original marked excluded has been surprised by
              their own record.
            */}
            This copy becomes the current one. The file already here stays on the record, marked
            as replaced by it, and the solicitation is queued for re-analysis.
          </p>
          <input
            type="file"
            aria-label={`Working copy of ${doc.name}`}
            className="mt-1 w-full text-xs"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          <label className="mt-2 block text-xs text-muted-foreground" htmlFor={`src-${doc.id}`}>
            Where did this copy come from? A replacement with no provenance is a file nobody can
            vouch for later.
          </label>
          <input
            id={`src-${doc.id}`}
            type="text"
            className="input mt-1 w-full text-sm"
            placeholder="Emailed by the contracting officer on the 14th"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              type="submit"
              className="btn-secondary text-xs"
              disabled={busy || !file || !note.trim()}
            >
              {busy ? "Uploading" : "Use this copy"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setAsking(null);
                setFile(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {(asking === "review" || asking === "exclude") && (
        <form
          className="mt-2 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            void patch(
              asking === "review" ? { action: "review", note } : { action: "exclude", reason: note }
            );
          }}
        >
          <label className="block text-xs text-muted-foreground" htmlFor={`note-${doc.id}`}>
            {asking === "review"
              ? "What does this document require? Whoever reads the brief next sees this instead of the file."
              : "Why is this document not relevant to the bid? An exclusion with no reason cannot be told apart from a lost file."}
          </label>
          <textarea
            id={`note-${doc.id}`}
            className="input mt-1 w-full text-sm"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
          />
          <div className="mt-1 flex items-center gap-2">
            <button type="submit" className="btn-secondary text-xs" disabled={busy || !note.trim()}>
              {busy ? "Saving" : "Save"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setAsking(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 w-full text-xs text-risk">{error}</p>}
    </>
  );
}
