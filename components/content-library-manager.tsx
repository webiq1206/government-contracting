"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CONTENT_CATEGORIES } from "@/lib/domain/content";
import { shortDate } from "@/lib/format";
import type { ContentCategory, ContentLibraryItem } from "@/lib/types";
import { UnsavedGuard } from "@/components/unsaved-guard";

const CATEGORY_META = Object.fromEntries(
  CONTENT_CATEGORIES.map((c) => [c.value, c])
) as Record<ContentCategory, (typeof CONTENT_CATEGORIES)[number]>;

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

type FilterId = "all" | ContentCategory;

/**
 * Content Library manager. The operator curates reusable, pre-approved snippets
 * here; the Bid Builder and Sources Sought Responder automatically pull the
 * best-matching ones into their drafts, so there is nothing to do at bid time.
 */
export function ContentLibraryManager({ items }: { items: ContentLibraryItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterId>("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * What the open form looked like when it was opened, derived from the record
   * it is editing rather than copied into a second piece of state. A copy has
   * to be cleared everywhere the form is, and one missed place is a guard that
   * fires on a form nobody has touched.
   */
  const baseline = useMemo<FormState | null>(() => {
    if (!form) return null;
    if (!form.id) return { ...EMPTY_FORM, category: form.category };
    const item = items.find((i) => i.id === form.id);
    return item
      ? {
          id: item.id,
          title: item.title,
          category: item.category,
          body: item.body,
          tags: (item.tags ?? []).join(", "),
        }
      : null;
  }, [form, items]);
  const dirty =
    form != null && baseline != null && JSON.stringify(form) !== JSON.stringify(baseline);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [items, filter]
  );

  const activeHint =
    filter === "all"
      ? "Save short, reusable paragraphs once. Brost Co inserts the best match into proposals and Sources Sought replies. Tag each snippet (trade, agency, NAICS) so the right one is chosen."
      : CATEGORY_META[filter].hint;

  function startNew() {
    setError(null);
    setForm({
      ...EMPTY_FORM,
      category: filter === "all" ? "past_performance" : filter,
    });
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

  const selectedCategoryHint = form ? CATEGORY_META[form.category]?.hint : null;

  return (
    <div className="space-y-5">
      <UnsavedGuard
        when={dirty}
        message="This snippet has unsaved changes. Leave without saving?"
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {activeHint}
        </p>
        {!form && (
          <button className="btn-primary shrink-0" onClick={startNew}>
            + Add snippet
          </button>
        )}
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filter snippets by type"
      >
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={`All (${items.length})`}
        />
        {CONTENT_CATEGORIES.map((c) => {
          const count = items.filter((i) => i.category === c.value).length;
          return (
            <FilterChip
              key={c.value}
              active={filter === c.value}
              onClick={() => setFilter(c.value)}
              label={`${c.label} (${count})`}
              title={c.hint}
            />
          );
        })}
      </div>

      {/* Editor */}
      {form && (
        <div className="card space-y-3 border-accent bg-accent-soft">
          <p className="eyebrow text-accent-strong">
            {form.id ? "Edit snippet" : "New snippet"}
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_minmax(12rem,16rem)]">
            <div>
              {/* Named by its label rather than by a placeholder, which
                  disappears the moment somebody types into the field. */}
              <label className="label mb-1 block" htmlFor="snippet-title">
                Title
              </label>
              <input
                id="snippet-title"
                className="input"
                placeholder="e.g. VA facility roofing, 2023"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label mb-1 block" htmlFor="snippet-type">
                Snippet type
              </label>
              <select
                id="snippet-type"
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
          {selectedCategoryHint && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {selectedCategoryHint}
            </p>
          )}
          <div>
            <label className="label mb-1 block" htmlFor="snippet-body">
              Content
            </label>
            <textarea
              id="snippet-body"
              className="input min-h-[140px] resize-y font-normal"
              placeholder="The reusable paragraph(s). Write it the way you want it to read in a proposal."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="snippet-tags">
              Tags
            </label>
            <input
              id="snippet-tags"
              className="input"
              placeholder="comma-separated, e.g. hvac, va, 236220"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Tags help Brost Co pick this snippet for the right bid.
            </p>
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
      {visible.length === 0 ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          {items.length === 0
            ? "No snippets yet. Add one when you have language you reuse on bids. Brost Co will pull matching snippets into drafts automatically."
            : "No snippets in this type yet. Switch to All, or add a new snippet for this type."}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <li
              key={item.id}
              className={`card ${item.is_active ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{item.title}</span>
                    <span
                      className="badge bg-muted text-muted-foreground"
                      title={CATEGORY_META[item.category]?.hint}
                    >
                      {CATEGORY_META[item.category]?.label ?? item.category}
                    </span>
                    {!item.is_active && (
                      <span className="badge bg-muted text-muted-foreground">disabled</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
                  {item.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.tags.map((t) => (
                        <span key={t} className="badge bg-accent-soft text-accent">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
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

function FilterChip({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        active
          ? "rounded-md border border-foreground/25 bg-foreground px-2.5 py-1 text-xs font-medium text-background"
          : "rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}
