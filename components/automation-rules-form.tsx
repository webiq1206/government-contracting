"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ruleConflicts, type AutomationRules } from "@/lib/domain/intake";
import { formatHour } from "@/lib/domain/call-queue";
import { EditorialTabs } from "@/components/editorial-tabs";
import { UnsavedGuard } from "@/components/unsaved-guard";

interface Preview {
  past_due_open: number;
  below_lead_time: number;
  past_retention: number;
  /** Calls waiting plus opportunities parked on the call stage. */
  queued_calls: number;
}

/**
 * Settings → Automation rules. Tabbed by concern; live preview shows impact
 * before anything is saved.
 */
export function AutomationRulesForm({
  initial,
  /**
   * Rendered for a role that may read these rules but not change them. A
   * native <fieldset disabled> rather than a per-control flag: it disables
   * everything inside it including controls added later, and assistive
   * technology announces the whole group as unavailable instead of each field
   * separately.
   */
  readOnly = false,
}: {
  initial: AutomationRules;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<AutomationRules>(initial);
  /*
   * Compared against what was loaded rather than tracked with a flag. These
   * rules govern how often other people's businesses hear from this company,
   * so an edit abandoned by a sidebar click is a change somebody believes they
   * made.
   */
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/automation/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, preview_only: true }),
        });
        if (res.ok) setPreview((await res.json()).preview);
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setForm(data.rules);
      setPreview(data.preview);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const num =
    (key: keyof AutomationRules) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  const conflicts = ruleConflicts(form);
  const blocking = conflicts.some((c) => c.severity === "error");

  const conflictPanel = conflicts.length > 0 && (
    /*
     * Rules that contradict each other, before publishing.
     *
     * Each field validates itself, but the interesting mistakes are pairs: a
     * red warning further out than the amber one, or a calling window an hour
     * wide. No single field can catch those, so they are checked together and
     * shown here rather than discovered in the behaviour a fortnight later.
     */
    <ul className="mt-4 space-y-1.5">
      {conflicts.map((c, i) => (
        <li
          key={i}
          role={c.severity === "error" ? "alert" : undefined}
          className={`rounded-md border px-3 py-2 text-sm leading-relaxed ${
            c.severity === "error"
              ? "border-risk/40 bg-risk/5 text-risk"
              : "border-review/40 bg-review/5 text-review"
          }`}
        >
          {c.message}
        </li>
      ))}
    </ul>
  );

  const saveBar = (
    <div className="mt-6 rounded-md border border-accent/40 bg-accent-soft/40 p-4">
      <h2 className="text-base font-semibold text-slate-900">
        What these values would do right now
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Checked live against your current data{previewing ? ", updating…" : ""}. Nothing
        happens until you press Save.
      </p>
      {preview && (
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
          <li>
            <span className="num font-semibold">{preview.past_due_open}</span> open opportunit
            {preview.past_due_open === 1 ? "y has" : "ies have"} already passed their deadline;
            the hourly sweep will archive {preview.past_due_open === 1 ? "it" : "them"} (with
            history preserved).
          </li>
          <li>
            <span className="num font-semibold">{preview.below_lead_time}</span> not-yet-scored
            opportunit{preview.below_lead_time === 1 ? "y" : "ies"} would fail the minimum
            lead-time rule{form.min_lead_days === 0 ? " (rule is off)" : ""}.
          </li>
          <li>
            <span className="num font-semibold">{preview.past_retention}</span> archived record
            {preview.past_retention === 1 ? "" : "s"} would be permanently deleted by the
            retention rule
            {form.retention_days === 0 ? " (retention is set to keep forever)" : ""}.
          </li>
          {!form.calls_enabled && (
            <li>
              <span className="num font-semibold">{preview.queued_calls}</span> queued call
              {preview.queued_calls === 1 ? "" : "s"} and opportunit
              {preview.queued_calls === 1 ? "y" : "ies"} waiting on a call would be cleared and
              moved on to collecting quotes.
            </li>
          )}
        </ul>
      )}
      {conflictPanel}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={saving || blocking}
        >
          {saving ? "Saving…" : "Save rules"}
        </button>
        {savedAt && !saving && (
          <span className="text-xs text-pursue">
            Saved at {savedAt}. Applied everywhere immediately.
          </span>
        )}
        {error && <span className="text-xs text-risk">{error}</span>}
      </div>
    </div>
  );

  return (
    <fieldset disabled={readOnly} className="contents">
    <UnsavedGuard
      when={dirty && !readOnly}
      message="Your automation rules have unsaved changes. Leave without saving?"
    />
    <EditorialTabs
      ariaLabel="Automation rule sections"
      defaultTab="deadlines"
      layout="fill"
      hashAliases={{
        deadlines: "deadlines",
        colors: "deadlines",
        lead: "lead-time",
        "lead-time": "lead-time",
        archive: "archive",
        retention: "archive",
        calls: "calls",
        calling: "calls",
        outreach: "outreach",
        followup: "outreach",
        "follow-up": "outreach",
      }}
      tabs={[
        {
          id: "deadlines",
          label: "Deadlines",
          content: (
            <div className="mx-auto w-full max-w-4xl space-y-4 px-5 py-6 sm:px-6">
              <section className="card">
                <h2 className="font-display text-xl text-foreground">Deadline warning colors</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Every opportunity shows a deadline badge on Today, Opportunities, and its own
                  record. These two numbers decide when that badge changes color. The badge
                  always spells out the status and days remaining in words, so nothing depends
                  on color alone.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Turn amber this many days before the deadline"
                    hint='The "approaching" warning. Amber means: still on track, but this needs attention soon.'
                  >
                    <input
                      type="number"
                      min={1}
                      className="input"
                      value={form.approaching_days}
                      onChange={num("approaching_days")}
                    />
                  </Field>
                  <Field
                    label="Turn red this many days before the deadline"
                    hint='The "urgent" warning. Red means: drop other work, this bid is at risk. Must be inside the amber window.'
                  >
                    <input
                      type="number"
                      min={1}
                      className="input"
                      value={form.urgent_days}
                      onChange={num("urgent_days")}
                    />
                  </Field>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="badge bg-pursue/10 text-pursue">
                    Normal · more than {form.approaching_days} days left
                  </span>
                  <span className="badge bg-review/15 text-review">
                    Approaching · under {form.approaching_days} days
                  </span>
                  <span className="badge bg-risk/15 text-risk">
                    Urgent · under {Math.min(form.urgent_days, form.approaching_days)} days
                  </span>
                  <span className="badge bg-risk text-white">Past due · deadline passed</span>
                  <span className="badge bg-slate-200 text-slate-600">
                    Expired · archived automatically
                  </span>
                </div>
              </section>
              {saveBar}
            </div>
          ),
        },
        {
          id: "lead-time",
          label: "Lead time",
          content: (
            <div className="mx-auto w-full max-w-4xl space-y-4 px-5 py-6 sm:px-6">
              <section className="card">
                <h2 className="font-display text-xl text-foreground">Minimum lead time</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  A bid needs time: reading the solicitation, finding subcontractors, collecting
                  quotes, building the package, and submitting early. This rule catches new
                  solicitations that are due too soon{" "}
                  <span className="font-medium text-slate-800">before</span> they enter the
                  pipeline. It never touches opportunities already in progress.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Minimum days between arrival and the deadline"
                    hint="Set 0 to turn this rule off. 7 to 14 days is typical."
                  >
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={form.min_lead_days}
                      onChange={num("min_lead_days")}
                    />
                  </Field>
                  <Field
                    label="What to do with a too-short opportunity"
                    hint='"Send to my review queue" lets you rescue a rush bid. "Pass automatically" archives it with the reason recorded.'
                  >
                    <select
                      className="select"
                      value={form.lead_action}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          lead_action: e.target.value === "dismiss" ? "dismiss" : "review",
                        }))
                      }
                    >
                      <option value="review">Send to my review queue</option>
                      <option value="dismiss">Pass automatically</option>
                    </select>
                  </Field>
                </div>
              </section>
              {saveBar}
            </div>
          ),
        },
        {
          id: "outreach",
          label: "Outreach",
          content: (
            <div className="mx-auto w-full max-w-4xl space-y-4 px-5 py-6 sm:px-6">
              <section className="card">
                <h2 className="font-display text-xl text-foreground">Chasing subcontractors</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  When a subcontractor does not reply to the first email, Brost Co sends a
                  follow-up. These are rules about how often this account writes to other
                  people&rsquo;s businesses, so they were worth putting where you can see them
                  rather than leaving fixed in the code. Chasing stops the moment somebody
                  replies, quotes, or declines, whichever follow-up they answer.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Hours to wait before following up"
                    hint="Measured from the message that went unanswered, not from the first one."
                  >
                    <input
                      type="number"
                      min={1}
                      max={720}
                      className="input"
                      value={form.followup_hours}
                      onChange={num("followup_hours")}
                    />
                  </Field>
                  <Field
                    label="Follow-ups per subcontractor, per opportunity"
                    hint="After the first email. 0 means never chase: one email and nothing more."
                  >
                    <input
                      type="number"
                      min={0}
                      max={5}
                      className="input"
                      value={form.followup_max}
                      onChange={num("followup_max")}
                    />
                  </Field>
                  <Field
                    label="Follow-ups sent per run"
                    hint="The sweep runs every fifteen minutes. A smaller number spreads a backlog out rather than sending it in a burst, which reads better to a mail provider."
                  >
                    <input
                      type="number"
                      min={1}
                      max={500}
                      className="input"
                      value={form.outreach_batch_limit}
                      onChange={num("outreach_batch_limit")}
                    />
                  </Field>
                </div>
                <p className="mt-4 rounded-md border border-border bg-surface p-3 text-sm leading-relaxed text-slate-700">
                  {form.followup_max === 0 ? (
                    <>
                      Nobody will be chased. Each subcontractor gets the first email and
                      nothing else, whether or not they answer.
                    </>
                  ) : (
                    <>
                      A subcontractor who never replies receives{" "}
                      <strong className="font-semibold">{1 + form.followup_max}</strong> email
                      {form.followup_max === 0 ? "" : "s"} in total about one opportunity, the
                      last of them about{" "}
                      <strong className="font-semibold">
                        {Math.round((form.followup_hours * form.followup_max) / 24) < 1
                          ? `${form.followup_hours * form.followup_max} hours`
                          : `${Math.round((form.followup_hours * form.followup_max) / 24)} days`}
                      </strong>{" "}
                      after the first.
                    </>
                  )}
                </p>
              </section>
              {saveBar}
            </div>
          ),
        },
        {
          id: "calls",
          label: "Calls",
          content: (
            <div className="mx-auto w-full max-w-4xl space-y-4 px-5 py-6 sm:px-6">
              <section className="card">
                <h2 className="font-display text-xl text-foreground">Phone calls</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  By default every sub you email also gets a prepared call card, so you can
                  follow up by phone. If you would rather run everything by email, turn calling
                  off: no call cards are created, the call step is removed from the pipeline,
                  and an opportunity moves straight from its outreach email to collecting
                  quotes.
                </p>
                <div className="mt-4 space-y-3">
                  <Choice
                    name="calls_enabled"
                    checked={form.calls_enabled}
                    onChange={() => setForm((f) => ({ ...f, calls_enabled: true }))}
                    label="Email and phone (default)"
                    hint="Each emailed sub becomes a call card in the Call Queue, and replies are prepared with a script and question list."
                  />
                  <Choice
                    name="calls_enabled"
                    checked={!form.calls_enabled}
                    onChange={() => setForm((f) => ({ ...f, calls_enabled: false }))}
                    label="Email only, never ask me to call"
                    hint="No call cards, no call step, nothing waiting on a phone call. Outreach emails, their follow-ups, and automatic quote capture from replies all keep running."
                  />
                </div>
                {!form.calls_enabled && (
                  <p className="mt-4 rounded-md border border-accent/40 bg-accent-soft/40 p-3 text-sm text-slate-700">
                    Saving this also empties the Call Queue you have now. Calls already logged
                    stay on the record as history; anything still waiting is cleared, and any
                    opportunity parked on the call step moves on to collecting quotes.
                  </p>
                )}
              </section>

              {form.calls_enabled && (
                <section className="card">
                  <h2 className="font-display text-xl text-foreground">When to call, and how often</h2>
                  <p className="mt-1 max-w-3xl text-sm text-slate-600">
                    The queue already works out what time it is where each subcontractor is.
                    These rules decide what it does with that: outside your window a card stays
                    in the list and says it is the wrong hour there rather than being handed to
                    you to dial. Attempts work the same way. Nothing is hidden, because a queue
                    that quietly drops work is a queue nobody trusts.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <Field
                      label="Earliest hour to call"
                      hint="In the subcontractor's own local time, not yours."
                    >
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="input"
                        value={form.call_hours_start}
                        onChange={num("call_hours_start")}
                      />
                    </Field>
                    <Field
                      label="Latest hour to call"
                      hint="Exclusive: 17 means calls stop at five o'clock their time."
                    >
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="input"
                        value={form.call_hours_end}
                        onChange={num("call_hours_end")}
                      />
                    </Field>
                    <Field
                      label="Unanswered attempts before stopping"
                      hint="0 means keep offering the card forever, which is what this used to do."
                    >
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className="input"
                        value={form.call_max_attempts}
                        onChange={num("call_max_attempts")}
                      />
                    </Field>
                  </div>
                  <p className="mt-4 rounded-md border border-border bg-surface p-3 text-sm leading-relaxed text-slate-700">
                    Calls are offered between{" "}
                    <strong className="font-semibold">
                      {formatHour(form.call_hours_start)} and {formatHour(form.call_hours_end)}
                    </strong>{" "}
                    where the subcontractor is.{" "}
                    {form.call_max_attempts === 0
                      ? "There is no attempt limit, so a number that never answers keeps coming back."
                      : `After ${form.call_max_attempts} unanswered attempt${form.call_max_attempts === 1 ? "" : "s"} the card stops being offered and says why.`}{" "}
                    A subcontractor in a state that spans two time zones has no certain hour, so
                    those are always offered with the caveat rather than guessed at.
                  </p>
                </section>
              )}
              {saveBar}
            </div>
          ),
        },
        {
          id: "archive",
          label: "Archive",
          content: (
            <div className="mx-auto w-full max-w-4xl space-y-4 px-5 py-6 sm:px-6">
              <section className="card">
                <h2 className="font-display text-xl text-foreground">Archive &amp; cleanup</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Expired and dismissed opportunities are{" "}
                  <span className="font-medium text-slate-800">archived, never deleted</span> by
                  default. This setting controls if and when archived records are eventually
                  purged. Records with a bid or a contract are always kept.
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Days to keep archived records"
                    hint="0 = keep everything forever (recommended until storage becomes a concern)."
                  >
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={form.retention_days}
                      onChange={num("retention_days")}
                    />
                  </Field>
                </div>
              </section>
              {saveBar}
            </div>
          ),
        },
      ]}
    />
    </fieldset>
  );
}

/**
 * A radio pair reads better than a switch here: both halves of the choice are
 * spelled out, so "off" cannot be mistaken for "calls are broken".
 */
function Choice({
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-md border p-3 transition ${
        checked ? "border-accent bg-accent-soft/30" : "border-border/55 hover:border-accent/50"
      }`}
    >
      <input
        type="radio"
        name={name}
        className="mt-1 h-4 w-4 shrink-0 accent-accent"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
    </label>
  );
}
