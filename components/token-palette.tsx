"use client";

import { useState } from "react";
import {
  TEMPLATE_TOKEN_GROUPS,
  TEMPLATE_TOKENS,
} from "@/lib/domain/template-tokens";

interface Props {
  /** Called when a fill-in field is clicked or dragged into the editor. */
  onInsert: (key: string) => void;
}

/**
 * The fill-in fields an operator can put in a template, and what each one does.
 *
 * The old palette was chips carrying a label and a truncated example. That is
 * enough to insert a field and not enough to reason about one, and the two
 * questions an operator actually has are "where does this value come from" and
 * "what happens on this email if it is empty". Neither had an answer anywhere
 * in the product, so the honest way to find out was to send one and look.
 *
 * Each field now shows both, plus whether an email may be sent without it.
 * That last one matters most: a required field that cannot be filled does not
 * produce a visible gap in the email, it blocks the send, and an operator who
 * does not know which fields are required cannot tell a held opportunity from
 * a broken one.
 */
export function TokenPalette({ onInsert }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="mb-3 max-w-2xl">
        <p className="text-sm font-medium text-foreground">Fill-in fields</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Click or drag a field into the subject or body. Brost Co replaces it with
          the real value when the email sends. Example:{" "}
          <span className="font-mono text-foreground">{"{{trade}}"}</span> becomes
          HVAC for that bid. Select a field name to see where its value comes from.
        </p>
      </div>

      <div className="space-y-5">
        {TEMPLATE_TOKEN_GROUPS.map((group) => {
          const tokens = TEMPLATE_TOKENS.filter((t) => t.group === group.id);
          if (tokens.length === 0) return null;
          return (
            <div key={group.id}>
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{group.blurb}</p>

              <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
                {tokens.map((tok) => {
                  const isOpen = open === tok.key;
                  return (
                    <li key={tok.key} className="px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          draggable
                          title={`Insert {{${tok.key}}}`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", `{{${tok.key}}}`);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          onClick={() => onInsert(tok.key)}
                          className="cursor-grab rounded border border-accent/30 bg-accent-soft px-2 py-1 font-mono text-[11px] text-accent-strong transition hover:border-accent hover:bg-accent/10 active:cursor-grabbing"
                        >
                          {`{{${tok.key}}}`}
                        </button>

                        <span className="text-xs font-medium text-foreground">
                          {tok.label}
                        </span>

                        {tok.required ? (
                          <span
                            className="badge bg-risk/15 text-risk"
                            title="An email will not send while this is empty."
                          >
                            Required
                          </span>
                        ) : (
                          <span className="badge bg-muted text-muted-foreground">
                            Optional
                          </span>
                        )}

                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : tok.key)}
                          className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {isOpen ? "Hide details" : "Details"}
                        </button>
                      </div>

                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {tok.description}
                      </p>

                      {isOpen && (
                        <dl className="mt-2 space-y-1.5 rounded bg-muted/40 p-2 text-[11px]">
                          <div>
                            <dt className="font-medium text-foreground">Comes from</dt>
                            <dd className="text-muted-foreground">{tok.dataSource}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-foreground">Example</dt>
                            <dd className="whitespace-pre-wrap font-mono text-muted-foreground">
                              {tok.example || "(empty)"}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium text-foreground">
                              If there is no value
                            </dt>
                            <dd className="text-muted-foreground">{tok.fallback}</dd>
                          </div>
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
