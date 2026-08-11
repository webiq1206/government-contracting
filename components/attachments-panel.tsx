interface DocRow {
  id: string;
  name: string;
  kind: string;
  storage_path?: string | null;
  meta?: { source_url?: string } | null;
}

/**
 * The always-visible attachments panel for a record. Every plan / spec / drawing
 * / clarification associated with the opportunity is surfaced here even if the
 * AI Bid Brief has not run yet, so nobody has to hunt for the source documents.
 */
export function AttachmentsPanel({ documents }: { documents: DocRow[] }) {
  return (
    <div className="card scroll-mt-12" id="attachments">
      <p className="eyebrow mb-3">
        Attachments · <span className="num">{documents.length}</span>
      </p>
      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">
          No attachments captured yet. The Ingestion agent will attach originals
          the next time this opportunity is refreshed from SAM.gov.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {documents.map((d) => {
            // Stored files are served through the authenticated file route; a
            // raw storage_path is not a URL and would 404 relative to this page.
            const href =
              d.meta?.source_url ??
              (d.storage_path ? `/api/files/${d.storage_path}` : "#");
            const canOpen = href !== "#";
            return (
              <li key={d.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-slate-800">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.kind}</p>
                  </div>
                  {canOpen ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost text-xs shrink-0"
                    >
                      Open →
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">Local file</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
