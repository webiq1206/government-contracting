"use client";

/**
 * One question, one answer, one row.
 *
 * The input is chosen by the question's own type, so recording an answer while
 * someone is talking is a tap for anything that can be a tap. Only genuinely
 * open-ended answers get a place to type, and nothing here opens a second
 * screen or a modal: everything is answerable without leaving the row.
 */

import type { CallQuestion } from "@/lib/domain/call-guide";

export type AnswerValue = string | number | boolean | null;

export function CallAnswer({
  question,
  value,
  onChange,
}: {
  question: CallQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const id = `q-${question.id}`;

  return (
    <div className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:gap-4 sm:py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm leading-snug text-foreground">
          {question.ask}
        </label>
        {question.note && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{question.note}</p>
        )}
      </div>
      <div className="shrink-0 sm:w-56">
        <Input id={id} question={question} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function Input({
  id,
  question,
  value,
  onChange,
}: {
  id: string;
  question: CallQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  switch (question.type) {
    case "yes_no":
      // Tapping the selected answer again clears it: a mis-tap mid-call must
      // be undoable without hunting for a reset.
      return (
        <Segmented
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
        />
      );

    case "choice":
      return (
        <Segmented
          options={question.options ?? []}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
        />
      );

    case "money":
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step="1"
            className="input w-full pl-6"
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? "0"}
          />
        </div>
      );

    case "number":
      return (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className="input w-full"
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
        />
      );

    case "date":
      return (
        <input
          id={id}
          type="date"
          className="input w-full"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "notes":
      return (
        <textarea
          id={id}
          rows={2}
          className="input min-h-[52px] w-full resize-y"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
        />
      );

    case "short_text":
    default:
      return (
        <input
          id={id}
          type="text"
          className="input w-full"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder}
        />
      );
  }
}

/** Options as one tappable row. Big enough to hit without looking. */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-border">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? "" : opt.value)}
            /* 44 tall, because these are pressed one-handed with a phone
               against an ear. At 36 a mis-tap costs the answer and, on a
               yes/no, records the opposite of what was said. */
            className={`min-h-11 flex-1 px-3 py-2 text-sm transition lg:min-h-0 ${
              active
                ? opt.value === "no"
                  ? "bg-risk text-on-status"
                  : "bg-accent text-on-status"
                : "text-muted-foreground hover:bg-surface"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
