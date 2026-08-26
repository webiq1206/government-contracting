interface DocRow {
  id: string;
  name: string;
  kind: string;
  storage_path?: string | null;
  meta?: { source_url?: string } | null;
}

/**
 * Files that are not source documents: the generated package pieces, the
 * capability statement, operator uploads.
 *
 * Source documents moved to DocumentInventoryPanel, which shows what became of
 * each one. These stayed here rather than joining them, because a generated
 * bid PDF has no extraction state and never will: an inventory row for it
 * would read "not processed yet" for ever, which is both alarming and false.
 *
 * They stayed visible, which is the part that matters. Dropping them to make
 * the new panel look tidy would take away access to the files an operator
 * downloads and sends.
 */
export function AttachmentsPanel({ documents }: { documents: DocRow[] }) {
  return (
    <div className="card">
      <p className="eyebrow mb-3">
        Generated and uploaded files · <span className="num">{documents.length}</span>
      </p>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing generated or uploaded for this bid yet.
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
