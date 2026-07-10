"use client";

import { useMemo, useRef, useState } from "react";
import {
  parseTokens,
  joinTokens,
  matchOptions,
  addToken,
  removeToken,
  type TokenOption,
} from "@/lib/domain/multiselect";

export type { TokenOption };

/**
 * A search-and-select multi-value input backed by a CSV string, so it drops into
 * the existing Company Profile form (which keeps these fields as comma-separated
 * strings) with no change to save logic. Type to filter the option list, click
 * to add; already-selected values show as removable chips. When `allowCustom` is
 * set, a value that matches no option can still be added with Enter, so operators
 * can enter anything the preset list doesn't cover.
 */
export function TokenMultiSelect({
  value,
  onChange,
  options,
  placeholder = "Search…",
  allowCustom = false,
  emptyText = "No matches.",
}: {
  value: string;
  onChange: (csv: string) => void;
  options: TokenOption[];
  placeholder?: string;
  allowCustom?: boolean;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => parseTokens(value), [value]);
  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value.toLowerCase(), o.label);
    return m;
  }, [options]);

  const matches = useMemo(
    () => matchOptions(options, q, selected, 10),
    [q, options, selected]
  );

  function commit(next: string[]) {
    onChange(joinTokens(next));
  }
  function add(token: string) {
    commit(addToken(selected, token));
    setQ("");
    inputRef.current?.focus();
  }
  function remove(token: string) {
    commit(removeToken(selected, token));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length > 0) add(matches[0].value);
      else if (allowCustom && q.trim()) add(q);
    } else if (e.key === "Backspace" && !q && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
  }

  const showDropdown = focused && (matches.length > 0 || (allowCustom && q.trim().length > 0));

  return (
    <div className="relative">
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((tok) => (
            <span
              key={tok}
              className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-0.5 text-xs text-accent-strong"
            >
              <span>{labelByValue.get(tok.toLowerCase()) ?? tok}</span>
              <button
                type="button"
                aria-label={`Remove ${tok}`}
                className="text-accent/70 hover:text-accent-strong"
                onClick={() => remove(tok)}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        className="input"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setFocused(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onClick={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />

      {showDropdown && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background py-1 text-sm shadow-lg">
          {matches.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-surface"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(o.value)}
              >
                <span className="text-slate-800">{o.label}</span>
                {o.label !== o.value && !o.label.includes(o.value) && (
                  <span className="ml-2 text-xs text-slate-400">{o.value}</span>
                )}
              </button>
            </li>
          ))}
          {matches.length === 0 && allowCustom && q.trim() && (
            <li>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-surface"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(q)}
              >
                Add &ldquo;<span className="font-medium">{q.trim()}</span>&rdquo;
              </button>
            </li>
          )}
          {matches.length === 0 && !allowCustom && (
            <li className="px-3 py-1.5 text-xs text-slate-400">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  );
}
