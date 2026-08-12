"use client";

import {
  TEMPLATE_TOKEN_GROUPS,
  TEMPLATE_TOKENS,
} from "@/lib/domain/template-tokens";

interface Props {
  /** Called when a fill-in field chip is clicked or dragged-and-dropped. */
  onInsert: (key: string) => void;
}

/**
 * Palette of fill-in fields the operator can click or drag into subject / body.
 * Each chip inserts a {{key}} placeholder that outreach replaces with live data.
 */
export function TokenPalette({ onInsert }: Props) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="mb-3 max-w-2xl">
        <p className="text-sm font-medium text-foreground">Fill-in fields</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Click or drag a field into the subject or body. Brost Co replaces it with
          the real value when the email sends. Example:{" "}
          <span className="font-mono text-foreground">{"{{trade}}"}</span> becomes
          HVAC for that bid.
        </p>
      </div>

      <div className="space-y-4">
        {TEMPLATE_TOKEN_GROUPS.map((group) => {
          const tokens = TEMPLATE_TOKENS.filter((t) => t.group === group.id);
          if (tokens.length === 0) return null;
          return (
            <div key={group.id}>
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{group.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {tokens.map((tok) => (
                  <button
                    key={tok.key}
                    type="button"
                    draggable
                    title={`${tok.description} Example: ${tok.example.split("\n")[0]}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", `{{${tok.key}}}`);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onInsert(tok.key)}
                    className="group max-w-full cursor-grab rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-left transition hover:border-accent hover:bg-accent/10 active:cursor-grabbing"
                  >
                    <span className="block text-xs font-medium text-accent-strong">
                      {tok.label}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {`{{${tok.key}}}`}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      e.g. {tok.example.split("\n")[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
