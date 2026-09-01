"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Which day you are looking at.
 *
 * Two shortcuts and a date field, rather than a list of thirty links. The
 * shortcuts cover what people actually want ("what did I miss yesterday",
 * "what has happened so far today") and the field covers the rest without
 * making the page carry a month of navigation it will almost never use.
 *
 * The field is bounded: nothing before the account's first day of records is
 * useful, and nothing after today exists yet. A picker that offers a future
 * date is offering an empty page.
 */
export function RecapDayPicker({
  value,
  today,
  yesterday,
  earliest,
  basePath = "/recap",
}: {
  value: string;
  today: string;
  yesterday: string;
  earliest: string;
  /**
   * The page the picker belongs to.
   *
   * It was hardcoded to `/recap`, and the platform recap renders the same
   * component: an administrator changing the day on `/admin/recap` was thrown
   * onto their own organization's recap, silently, with the date they asked
   * for. Every control here has to stay on the page it was pressed from.
   */
  basePath?: string;
}) {
  const router = useRouter();

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      key={label}
      href={href}
      className={
        active
          ? "dash-tab dash-tab--active whitespace-nowrap text-xs uppercase tracking-[0.12em]"
          : "dash-tab whitespace-nowrap text-xs uppercase tracking-[0.12em]"
      }
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {tab(`${basePath}?date=${yesterday}`, "Yesterday", value === yesterday)}
      {tab(`${basePath}?date=${today}`, "Today so far", value === today)}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Any day</span>
        <input
          type="date"
          value={value}
          min={earliest}
          max={today}
          onChange={(e) => {
            const next = e.target.value;
            if (next) router.push(`${basePath}?date=${next}`);
          }}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
        />
      </label>
    </div>
  );
}
