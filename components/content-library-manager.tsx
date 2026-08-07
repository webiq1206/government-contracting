"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CONTENT_CATEGORIES } from "@/lib/domain/content";
import { shortDate } from "@/lib/format";
import type { ContentCategory, ContentLibraryItem } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_CATEGORIES.map((c) => [c.value, c.label])
);

interface FormState {
  id: string | null; // null = creating a new snippet
  title: string;
  category: ContentCategory;
  body: string;
  tags: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  title: "",
  category: "past_performance",
  body: "",
  tags: "",
};

/**
 * Content Library manager. The operator curates reusable, pre-approved snippets
 * here; the Bid Builder and Sources Sought Responder automatically pull the
 * best-matching ones into their drafts, so there is nothing to do at bid time.
 */
export function ContentLibraryManager({ items }: { items: ContentLibraryItem[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setError(null);
    setForm({ ...EMPTY_FORM });
  }
  function startEdit(item: ContentLibraryItem) {
    setError(null);
    setForm({
      id: item.id,
      title: item.title,
      category: item.category,
      body: item.body,
      tags: (item.tags ?? []).join(", "),
    });
  }

  async function save() {
    if (!form) return;
    setError(null);
    setBusyId("form");
    try {
      const payload = {
        title: form.title,
        category: form.category,
        body: form.body,
        tags: form.tags
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
      };
      const res = await fetch(form.id ? `/api/content/${form.id}` : "/api/content", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setForm(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: ContentLibraryItem) {
    setBusyId(item.id);
    try {
      await fetch(`/api/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: ContentLibraryItem) {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    setBusyId(item.id);
    try {
      await fetch(`/api/content/${item.id}`, { method: "DELETE" });
      if (form?.id === item.id) setForm(null);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
          Save the language you reuse across bids, your best past-performance
          write-ups, capability statements, win themes, and technical approaches.
          The automation pulls the most relevant snippets into each draft on its
          own; the more specific your <span className="font-medium">tags</span>{" "}
          (trades, agencies, NAICS, keywords), the better the match.
        </p>
        {!form && (
          <button className="btn-primary shrink-0" onClick={startNew}>
            + Add snippet
          </button>
        )}
      </div>

      {/* Editor */}
      {form && (
        <div className="card space-y-3 border-accent bg-accent-soft">
          <p className="eyebrow text-accent-strong">
            {form.id ? "Edit snippet" : "New snippet"}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label mb-1 block">Title</label>
              <input
                className="input"
                placeholder="e.g. VA facility roofing, 2023"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label mb-1 block">Category</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as ContentCategory })
                }
              >
                {CONTENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label mb-1 block">Content</label>
            <textarea
              className="input min-h-[140px] resize-y font-normal"
              placeholder="The reusable paragraph(s). Written as you'd want it to read in a proposal."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div>
            <label className="label mb-1 block">Tags</label>
            <input
              className="input"
              placeholder="comma-separated, e.g. hvac, va, 236220"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={save} disabled={busyId === "form"}>
              {busyId === "form" ? "Saving…" : "Save snippet"}
            </button>
            <button className="btn-ghost" onClick={() => setForm(null)}>
              Cancel
            </button>
            {error && <span className="text-xs text-risk">{error}</span>}
          </div>
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No content yet. Add your first reusable snippet, once you have a few,
          every bid narrative and Sources Sought response starts drawing on them
          automatically.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={`card ${item.is_active ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{item.title}</span>
                    <span className="badge bg-surface text-slate-600">
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                    {!item.is_active && (
                      <span className="badge bg-slate-200 text-slate-500">disabled</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.body}</p>
                  {item.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.tags.map((t) => (
                        <span key={t} className="badge bg-accent-soft text-accent">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Updated {shortDate(item.updated_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => toggleActive(item)}
                    disabled={busyId === item.id}
                    title={item.is_active ? "Stop using in drafts" : "Use in drafts"}
                  >
                    {item.is_active ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => startEdit(item)}
                    disabled={busyId === item.id}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-ghost text-xs text-risk"
                    onClick={() => remove(item)}
                    disabled={busyId === item.id}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
