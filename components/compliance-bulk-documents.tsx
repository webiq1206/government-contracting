"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * File certificates against several items in one pass.
 *
 * The single-item uploader is the right place to attach a policy while you are
 * looking at it. It is the wrong place to work through a folder of scans the
 * broker sent in January, because that means finding each item on the board
 * first, and the ones that get skipped are the ones nobody was looking for.
 *
 * So this lists exactly the items with nothing stored, which is the working
 * set, and lets each one be filled without leaving the row.
 */

export interface BulkDocTarget {
  id: string;
  label: string;
  /** Where it sits on the board, so two similarly named items are separable. */
  area: string;
  dueDisplay: string;
}

type RowState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; count: number }
  | { kind: "failed"; error: string };

export function ComplianceBulkDocuments({ targets }: { targets: BulkDocTarget[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, RowState>>({});

  if (targets.length === 0) return null;

  const filled = Object.values(state).filter((s) => s.kind === "done").length;

  async function upload(target: BulkDocTarget, files: FileList | null) {
    if (!files || files.length === 0) return;
    setState((s) => ({ ...s, [target.id]: { kind: "busy" } }));
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("file", file);
      const res = await fetch(`/api/compliance/${target.id}/documents`, {
        method: "POST",
        body,
      });
      const data = (await res.json().catch(() => ({}))) as {
        stored?: number;
        error?: string;
        failed?: { name: string; error: string }[];
      };
      if (!res.ok) {
        setState((s) => ({
          ...s,
          [target.id]: { kind: "failed", error: data.error ?? "Nothing was stored." },
        }));
        return;
      }
      /*
       * A partial result is reported as a partial result. Saying "done" over a
       * batch where one file was refused is how the refused one is never
       * noticed, and the file nobody noticed is the certificate somebody is
       * asked for later.
       */
      if (data.failed?.length) {
        setState((s) => ({
          ...s,
          [target.id]: { kind: "failed", error: data.failed![0].error },
        }));
      } else {
        setState((s) => ({ ...s, [target.id]: { kind: "done", count: data.stored ?? 0 } }));
      }
      router.refresh();
    } catch (e) {
      setState((s) => ({ ...s, [target.id]: { kind: "failed", error: (e as Error).message } }));
    }
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="label">
            {targets.length} item{targets.length === 1 ? "" : "s"} with no document on file
          </h2>
          {/*
            The cost, not the count. A date being watched is not the same as a
            certificate being holdable, and the board could not tell those
            apart until it could store files.
          */}
          <p className="mt-1 text-xs text-muted-foreground">
            These dates are tracked, but there is nothing here to produce if a contracting
            officer asks for the certificate.
          </p>
        </div>
        <button className="btn-ghost text-xs" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Attach files"}
        </button>
      </div>

      {open && (
        <>
          {filled > 0 && (
            <p className="mt-3 text-xs text-pursue-strong">
              {filled} of {targets.length} now {filled === 1 ? "has" : "have"} a file.
            </p>
          )}
          <ul className="mt-3 divide-y divide-border">
            {targets.map((t) => {
              const row = state[t.id] ?? { kind: "idle" as const };
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 text-sm text-foreground">{t.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {/*
                      "no date set" rather than a bare dash. The board already
                      uses that phrase for an item it cannot count down, and
                      "due -" reads as a formatting slip rather than a fact.
                    */}
                    {t.area} ·{" "}
                    {t.dueDisplay && t.dueDisplay !== "-"
                      ? `due ${t.dueDisplay}`
                      : "no date set"}
                  </span>
                  {row.kind === "done" ? (
                    <span className="text-xs text-pursue-strong">
                      {row.count} file{row.count === 1 ? "" : "s"} filed
                    </span>
                  ) : (
                    <label
                      className={`btn-ghost text-xs ${row.kind === "busy" ? "opacity-60" : "cursor-pointer"}`}
                    >
                      {row.kind === "busy" ? "Uploading..." : "Choose files"}
                      <input
                        type="file"
                        className="sr-only"
                        multiple
                        disabled={row.kind === "busy"}
                        onChange={(e) => {
                          void upload(t, e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {row.kind === "failed" && (
                    <span className="basis-full text-xs text-risk">{row.error}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
