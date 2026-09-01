"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RECAP_SECTION_BLURBS,
  RECAP_SECTION_KEYS,
  RECAP_SECTION_TITLES,
  type RecapSectionKey,
  type RecapSettings,
} from "@/lib/domain/recap/types";

export interface RecapMember {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  timezone: string;
  timezoneIsDefault: boolean;
  optedOut: boolean;
  receiving: boolean;
}

export interface RecapDeliveryRow {
  id: string;
  localDate: string;
  recipientEmail: string;
  timezone: string;
  status: string;
  late: boolean;
  quiet: boolean;
  test: boolean;
  sentAt: string | null;
  attempts: number;
  urgentCount: number;
  subject: string | null;
  error: string | null;
  createdAt: string;
}

/**
 * A send that was started and never finished.
 *
 * The worker stamps a row before handing the mail to the provider and again
 * when the provider answers. A pending row this old means the second stamp
 * never came: the mail may have gone out, or it may not have. Automation will
 * not guess, so the row waits here for a person who can ask the recipient.
 */
function isStuck(h: RecapDeliveryRow): boolean {
  if (h.status !== "pending") return false;
  return Date.now() - new Date(h.createdAt).getTime() > 15 * 60_000;
}

const ROLE_CHOICES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

/**
 * The recap's admin controls.
 *
 * Grouped by the question each one answers rather than by data type: whether
 * it runs, what is in it, who gets it, what counts as urgent, and what
 * actually went out. The preview and the test send sit at the bottom next to
 * the history, because those three are one activity: check it, send it to
 * yourself, see that it arrived.
 */
export function RecapSettingsForm({
  initial,
  members,
  history,
  readOnly = false,
  mailReady,
}: {
  initial: RecapSettings;
  members: RecapMember[];
  history: RecapDeliveryRow[];
  readOnly?: boolean;
  mailReady: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<RecapSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/recap/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That did not save.");
        return;
      }
      setForm(data.settings);
      setSavedAt(new Date().toLocaleTimeString());
      setPreviewKey((k) => k + 1);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/recap/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "The test send failed.");
        return;
      }
      setNotice(
        `Sent to ${data.sentTo}. It covers ${data.localDate} and is marked as a test, so nobody else received it.`
      );
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  async function retry(id: string) {
    setRetrying(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/recap/deliveries/${id}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "The retry failed.");
        return;
      }
      setNotice(`Sent again to ${data.sentTo}.`);
      router.refresh();
    } finally {
      setRetrying(null);
    }
  }

  const toggleSection = (key: RecapSectionKey) =>
    setForm((f) => ({
      ...f,
      sections: f.sections.includes(key)
        ? f.sections.filter((s) => s !== key)
        : [...f.sections, key],
    }));

  const toggleRole = (role: string) =>
    setForm((f) => ({
      ...f,
      recipient_roles: f.recipient_roles.includes(role)
        ? f.recipient_roles.filter((r) => r !== role)
        : [...f.recipient_roles, role],
    }));

  const toggleExcluded = (userId: string) =>
    setForm((f) => ({
      ...f,
      excluded_user_ids: f.excluded_user_ids.includes(userId)
        ? f.excluded_user_ids.filter((id) => id !== userId)
        : [...f.excluded_user_ids, userId],
    }));

  const toggleNamed = (userId: string) =>
    setForm((f) => ({
      ...f,
      recipient_user_ids: f.recipient_user_ids.includes(userId)
        ? f.recipient_user_ids.filter((id) => id !== userId)
        : [...f.recipient_user_ids, userId],
    }));

  const threshold = (key: keyof RecapSettings["urgent"]) => (value: number) =>
    setForm((f) => ({ ...f, urgent: { ...f.urgent, [key]: value } }));

  const sendsNeedingADecision = history.filter((h) => canRetry(h)).length;

  return (
    <fieldset disabled={readOnly} className="contents">
      <div className="lg:flex lg:items-start lg:gap-5">
        {/*
          * The rail.
          *
          * Six groups of settings, several hundred lines of them, and the two
          * questions people actually arrive with -- "who is getting this" and
          * "did yesterday's go out" -- sit furthest down. Reaching either meant
          * scrolling past everything else, and the Save button was somewhere in
          * the middle of that scroll.
          *
          * So the sections are named up front, each with the state that would
          * make you pick it, and the save control rides along. Wide screens
          * only: on a phone the sections are already one column in the order
          * you read them, and a rail above them would be a second list to
          * scroll past before reaching the first.
          */}
        <nav
          aria-label="Recap settings"
          className="hidden lg:sticky lg:top-0 lg:block lg:w-[220px] lg:shrink-0 lg:self-start"
        >
          <ul className="space-y-0.5">
            {[
              {
                id: "recap-send",
                label: "The morning send",
                note: form.enabled ? form.send_at : "off",
                warn: !form.enabled,
              },
              {
                id: "recap-sections",
                label: "Sections",
                note: `${form.sections.length} of ${RECAP_SECTION_KEYS.length}`,
                warn: form.sections.length === 0,
              },
              {
                id: "recap-recipients",
                label: "Recipients",
                note: String(members.filter((m) => m.receiving).length),
                warn: members.every((m) => !m.receiving),
              },
              { id: "recap-urgent", label: "What counts as urgent", note: null, warn: false },
              { id: "recap-preview", label: "Preview and test", note: null, warn: false },
              {
                id: "recap-history",
                label: "What actually went out",
                note: sendsNeedingADecision > 0 ? `${sendsNeedingADecision} to decide` : null,
                warn: sendsNeedingADecision > 0,
              },
            ].map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="tap flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent-soft hover:text-foreground"
                >
                  <span>{s.label}</span>
                  {s.note && (
                    <span
                      className={`num shrink-0 text-xs ${
                        s.warn ? "text-risk" : "text-muted-foreground"
                      }`}
                    >
                      {s.note}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              className="btn-primary w-full"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
            <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
              {dirty && !saving
                ? "Unsaved changes."
                : savedAt
                  ? `Saved at ${savedAt}`
                  : "Nothing changed yet."}
            </p>
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-5">
        {!mailReady && (
          <p className="rounded-md border border-risk/50 bg-risk/5 px-3 py-2 text-sm text-foreground">
            <strong className="text-risk">No recap can be delivered right now.</strong> The
            platform inbox is not connected, so the morning send has nothing to send through.
            Everything below can still be set up; nothing will arrive until that is fixed.
          </p>
        )}

        {error && (
          <p className="rounded-md border border-risk/50 bg-risk/5 px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-md border border-pursue/50 bg-pursue/5 px-3 py-2 text-sm text-foreground">
            {notice}
          </p>
        )}

        {/* 1. Whether it runs, and when. */}
        <section id="recap-send" className="card scroll-mt-4 p-4">
          <h2 className="font-display text-base font-semibold text-foreground">
            The morning send
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Sent at this time in each recipient&apos;s own zone, so everybody gets it at the
            start of their own day rather than the start of somebody else&apos;s.
          </p>

          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              <span>
                Send the daily recap
                <span className="block text-xs text-muted-foreground">
                  Off means nobody on this account receives it, whatever their own preference
                  says.
                </span>
              </span>
            </label>

            <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <span className="w-40">Send at</span>
              <input
                type="time"
                value={form.send_at}
                onChange={(e) => setForm((f) => ({ ...f, send_at: e.target.value }))}
                className="input w-32"
              />
              <span className="text-xs text-muted-foreground">
                in each recipient&apos;s own time zone
              </span>
            </label>

            <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <span className="w-40">Still worth sending for</span>
              <input
                type="number"
                min={1}
                max={23}
                value={form.late_cutoff_hours}
                onChange={(e) =>
                  setForm((f) => ({ ...f, late_cutoff_hours: Number(e.target.value) }))
                }
                className="input w-20"
              />
              <span className="text-xs text-muted-foreground">
                hours after the send time. A missed morning goes out later, marked late; past
                this it is dropped and tomorrow&apos;s recap covers the ground.
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.skip_when_empty}
                onChange={(e) => setForm((f) => ({ ...f, skip_when_empty: e.target.checked }))}
              />
              <span>
                Skip days when nothing happened
                <span className="block text-xs text-muted-foreground">
                  Off by default. An email that does not arrive is ambiguous: you cannot tell
                  &quot;nothing happened&quot; from &quot;the recap is broken&quot;. Left off, a
                  quiet day gets a three-line note instead of silence.
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* 2. What is in it. */}
        <section id="recap-sections" className="card scroll-mt-4 p-4">
          <h2 className="font-display text-base font-semibold text-foreground">Sections</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Turn off what you do not read. The order never changes, whatever you pick: the
            recap is read in fifteen seconds and that only works if the shape is the same every
            morning.
          </p>
          <ul className="mt-3 space-y-2">
            {RECAP_SECTION_KEYS.map((key) => (
              <li key={key}>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.sections.includes(key)}
                    onChange={() => toggleSection(key)}
                  />
                  <span>
                    {RECAP_SECTION_TITLES[key]}
                    <span className="block text-xs text-muted-foreground">
                      {RECAP_SECTION_BLURBS[key]}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {form.sections.length === 0 && (
            <p className="mt-2 text-xs text-review">
              With no sections chosen there is nothing to send, so nothing will go out.
            </p>
          )}
        </section>

        {/* 3. Who gets it. */}
        <section id="recap-recipients" className="card scroll-mt-4 p-4">
          <h2 className="font-display text-base font-semibold text-foreground">Recipients</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            By role, with exceptions by name. Everybody on the account sees the same recap;
            there is no per-person filtering, so what one person reads is what the next one
            reads.
          </p>

          <div className="mt-3 flex flex-wrap gap-3">
            {ROLE_CHOICES.map((r) => (
              <label key={r.value} className="flex items-center gap-1.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.recipient_roles.includes(r.value)}
                  onChange={() => toggleRole(r.value)}
                />
                {r.label}
              </label>
            ))}
          </div>

          <ul className="mt-4 space-y-2">
            {members.map((m) => {
              const excluded = form.excluded_user_ids.includes(m.userId);
              const named = form.recipient_user_ids.includes(m.userId);
              return (
                <li
                  key={m.userId}
                  className="panel-inset flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {m.name ?? m.email}{" "}
                      <span className="text-xs text-muted-foreground">({m.role})</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email} · {m.timezone}
                      {m.timezoneIsDefault ? " (default, not set by them)" : ""}
                      {m.optedOut ? " · they turned it off themselves" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span
                      className={
                        m.receiving
                          ? "rounded border border-pursue/50 bg-pursue/10 px-1.5 py-0.5 text-pursue-strong"
                          : "rounded border border-border px-1.5 py-0.5 text-muted-foreground"
                      }
                    >
                      {m.receiving ? "Receiving" : "Not receiving"}
                    </span>
                    <label className="flex items-center gap-1 text-muted-foreground">
                      <input type="checkbox" checked={named} onChange={() => toggleNamed(m.userId)} />
                      Always
                    </label>
                    <label className="flex items-center gap-1 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={excluded}
                        onChange={() => toggleExcluded(m.userId)}
                      />
                      Never
                    </label>
                  </div>
                </li>
              );
            })}
            {members.length === 0 && (
              <li className="text-sm text-muted-foreground">Nobody else is on this account yet.</li>
            )}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            &quot;Never&quot; beats the role rule and beats &quot;Always&quot;. Somebody who has
            turned the recap off on their own account page stays off whatever is set here.
          </p>
        </section>

        {/* 4. What counts as urgent. */}
        <section id="recap-urgent" className="card scroll-mt-4 p-4">
          <h2 className="font-display text-base font-semibold text-foreground">
            What counts as urgent
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            These decide what lands at the top of the recap. Set them too wide and the urgent
            section becomes wallpaper; too narrow and it misses the thing you needed.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Threshold
              label="Bid deadline within"
              suffix="hours"
              value={form.urgent.deadline_hours}
              onChange={threshold("deadline_hours")}
              min={1}
              max={336}
            />
            <Threshold
              label="Reply unanswered for"
              suffix="hours"
              value={form.urgent.unanswered_reply_hours}
              onChange={threshold("unanswered_reply_hours")}
              min={1}
              max={336}
            />
            <Threshold
              label="Failed sends, at least"
              suffix="in the day"
              value={form.urgent.failed_send_count}
              onChange={threshold("failed_send_count")}
              min={1}
              max={100}
            />
            <Threshold
              label="Compliance due within"
              suffix="days"
              value={form.urgent.compliance_days}
              onChange={threshold("compliance_days")}
              min={1}
              max={90}
            />
            <Threshold
              label="Review window closing within"
              suffix="hours"
              value={form.urgent.review_expiry_hours}
              onChange={threshold("review_expiry_hours")}
              min={1}
              max={336}
            />
          </div>
        </section>

        {/*
          * The narrow-screen copy of the save control. On a wide screen the
          * rail carries it and stays on screen, so exactly one of the two is
          * ever visible: a settings page with two Save buttons in view is a
          * page somebody presses twice.
          */}
        <div className="flex flex-wrap items-center gap-3 lg:hidden">
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save settings"}
          </button>
          {savedAt && <span className="text-xs text-muted-foreground">Saved at {savedAt}</span>}
          {dirty && !saving && (
            <span className="text-xs text-review">Unsaved changes.</span>
          )}
        </div>

        {/* 5. Check it, send it, see what went out. */}
        <section id="recap-preview" className="card scroll-mt-4 p-4">
          <h2 className="font-display text-base font-semibold text-foreground">
            Preview and test
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The preview is the real mail for yesterday, built from real records. It is not sent
            and it does not age anything, so you can open it as often as you like.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                setShowPreview((s) => !s);
                setPreviewKey((k) => k + 1);
              }}
            >
              {showPreview ? "Hide preview" : "Show preview"}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={sendTest}
              disabled={testing || !mailReady}
            >
              {testing ? "Sending..." : "Send a test to me"}
            </button>
          </div>
          {showPreview && (
            <iframe
              key={previewKey}
              title="Recap preview"
              src={`/api/recap/preview?format=html&v=${previewKey}`}
              sandbox=""
              className="mt-3 h-[520px] w-full rounded-md border border-border bg-white"
            />
          )}
        </section>

        <DeliveryHistory
          history={history}
          retry={retry}
          retrying={retrying}
          readOnly={readOnly}
        />
        </div>
      </div>
    </fieldset>
  );
}

function Threshold({
  label,
  suffix,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
      <span className="min-w-[14rem]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input w-20"
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </label>
  );
}
/** The status word, and the colour that only ever repeats it. */
function statusLabel(h: RecapDeliveryRow): string {
  return h.status === "pending" && isStuck(h) ? "not confirmed" : h.status;
}

function statusClasses(h: RecapDeliveryRow): string {
  if (h.status === "sent") {
    return "rounded border border-pursue/50 bg-pursue/10 px-1.5 py-0.5 text-xs text-pursue-strong";
  }
  if (h.status === "pending") {
    return "rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground";
  }
  return "rounded border border-risk/50 bg-risk/10 px-1.5 py-0.5 text-xs text-risk";
}

function canRetry(h: RecapDeliveryRow): boolean {
  return h.status === "failed" || h.status === "bounced" || isStuck(h);
}

/**
 * What actually went out, with the mail itself beside the list.
 *
 * The delivery record has always kept the rendered copy: that is what makes a
 * retry send the mail written for that morning rather than a fresh recap
 * describing a different day. Nobody could read it. The history showed a
 * subject, an address and, on a bad morning, a provider's error string, and
 * the only way to answer "what did they actually receive" was to ask them to
 * forward it back.
 *
 * So: the sends on the left, the one you picked on the right, in a frame, as
 * it arrived. Deciding whether to resend is reading the thing and then
 * pressing the button, and both are now in one place.
 *
 * The selection is client state rather than a query parameter on purpose. It
 * lives inside a settings form that holds unsaved edits, and navigating to
 * carry a selection in the URL would throw them away. That makes the phone
 * rule stricter, not looser: with no URL to return to, the pane must start
 * closed and must carry its own way back to the list.
 */
function DeliveryHistory({
  history,
  retry,
  retrying,
  readOnly,
}: {
  history: RecapDeliveryRow[];
  retry: (id: string) => void;
  retrying: string | null;
  readOnly: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const selected = history.find((h) => h.id === selectedId) ?? null;
  const problems = history.filter((h) => canRetry(h)).length;

  function open(id: string) {
    setSelectedId(id);
    setOpened(true);
  }

  return (
    <section id="recap-history" className="card scroll-mt-4 p-4">
      <h2 className="font-display text-base font-semibold text-foreground">
        What actually went out
      </h2>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        The delivery record, including failures. Pick one to read the mail
        exactly as it was sent. A failed send keeps its copy, so a retry sends
        that copy rather than a fresh recap describing a different day.
      </p>

      {history.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing has been sent yet.
        </p>
      ) : (
        <div className="mt-3 lg:flex lg:items-start lg:gap-4">
          <div
            className={`${opened ? "hidden lg:block" : "block"} lg:w-[320px] lg:shrink-0`}
          >
            {problems > 0 && (
              <p className="mb-2 text-xs text-risk">
                {problems === 1
                  ? "1 send needs a decision."
                  : `${problems} sends need a decision.`}
              </p>
            )}
            <ul className="scroll-thin space-y-2 lg:max-h-[520px] lg:overflow-y-auto lg:pr-1">
              {history.map((h) => {
                const active = h.id === selectedId;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => open(h.id)}
                      aria-current={active ? "true" : undefined}
                      className={`panel-inset w-full rounded-md px-3 py-2 text-left transition-colors ${
                        active
                          ? "ring-1 ring-gold"
                          : "hover:border-foreground/30"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {h.subject ??
                              "Nothing to report, so no email was sent"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {h.localDate} · {h.recipientEmail}
                            {h.test ? " · test" : ""}
                            {h.late ? " · late" : ""}
                          </span>
                        </span>
                        <span className={`${statusClasses(h)} shrink-0`}>
                          {statusLabel(h)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div
            className={`${opened ? "block" : "hidden lg:block"} min-w-0 flex-1`}
          >
            {selected ? (
              <div>
                <button
                  type="button"
                  onClick={() => setOpened(false)}
                  className="btn-ghost mb-2 text-xs lg:hidden"
                >
                  Back to the list
                </button>

                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {selected.subject ??
                        "Nothing to report, so no email was sent"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selected.localDate} · {selected.recipientEmail} ·{" "}
                      {selected.timezone}
                      {selected.attempts > 1
                        ? ` · ${selected.attempts} attempts`
                        : ""}
                      {selected.sentAt
                        ? ` · sent ${new Date(selected.sentAt).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={statusClasses(selected)}>
                      {statusLabel(selected)}
                    </span>
                    {canRetry(selected) && !readOnly && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => retry(selected.id)}
                        disabled={retrying === selected.id}
                      >
                        {retrying === selected.id
                          ? "Sending..."
                          : "Send it again"}
                      </button>
                    )}
                  </div>
                </div>

                {selected.error && (
                  <p className="mt-2 rounded-md border border-risk/50 bg-risk/5 px-3 py-2 text-xs text-foreground">
                    <strong className="text-risk">
                      The mail service refused it.
                    </strong>{" "}
                    {selected.error}
                  </p>
                )}

                {selected.status === "pending" && isStuck(selected) && (
                  <p className="mt-2 rounded-md border border-review/50 bg-review/5 px-3 py-2 text-xs text-foreground">
                    This one was handed to the mail service and never confirmed,
                    so we cannot tell whether it arrived. Nothing was sent again
                    automatically, because a second copy is the one thing that
                    cannot be undone. Send it again if the recipient says it
                    never came.
                  </p>
                )}

                {selected.quiet && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    A quiet morning: the short variant was sent rather than
                    eight empty sections.
                  </p>
                )}

                {/*
                 * The stored copy, sandboxed. Same treatment as the live
                 * preview above: it is mail written elsewhere, rendered on our
                 * page, and it gets no script and no origin.
                 */}
                <iframe
                  key={selected.id}
                  title={`Recap sent to ${selected.recipientEmail} for ${selected.localDate}`}
                  src={`/api/recap/deliveries/${selected.id}/html`}
                  sandbox=""
                  className="mt-3 h-[520px] w-full rounded-md border border-border bg-white"
                />
              </div>
            ) : (
              <p className="panel-inset rounded-md p-5 text-sm text-muted-foreground">
                Pick a send to read the mail that went out, and to decide
                whether it needs sending again.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
