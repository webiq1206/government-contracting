import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecapView } from "@/components/recap-view";
import { renderRecapEmail } from "@/lib/domain/recap/email";
import { buildRecap } from "@/lib/domain/recap/sections";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";
import { emptyFacts } from "./helpers/recap-facts";

const now = new Date("2026-10-11T14:00:00Z");
const days = [
  { localDate: "2026-10-11", dayLabel: "Sunday, October 11", partial: true },
  { localDate: "2026-10-10", dayLabel: "Saturday, October 10", partial: false },
  { localDate: "2026-10-03", dayLabel: "Saturday, October 3", partial: false },
];

describe.each([false, true])("completed-work date copy, populated=%s", populated => {
  it.each(days)("describes the selected day $localDate in page and email", day => {
    const recap = buildRecap(emptyFacts({
      // A visible normal recap is required even when no work was completed.
      problems: [{ key: "fixture", title: "Synthetic problem", detail: null,
        count: 1, lastAt: now.toISOString(), severity: "warning" }],
      completed: populated ? [{ key: "done", label: "Synthetic completed item",
        detail: null, at: `${day.localDate}T12:00:00Z` }] : [],
    }), DEFAULT_RECAP_SETTINGS, {
      ...day, scope: "org", timezone: "America/Denver", now, ages: {},
    });
    const mail = renderRecapEmail(recap, { appUrl: "https://app.example.test" });
    const page = renderToStaticMarkup(createElement(RecapView, { recap }));

    expect(recap.quiet).toBe(false);
    for (const rendered of [page, mail.html]) {
      expect(rendered).toContain("Work that finished on this day, so it is off your list.");
      expect(rendered).not.toContain("Work that finished yesterday");
    }
    // Plaintext omits section descriptions, but must retain the same day/items.
    for (const rendered of [page, mail.html, mail.text]) {
      expect(rendered).toContain(day.dayLabel);
      expect(rendered).toContain(populated ? "Synthetic completed item" : "Nothing was completed.");
    }
    expect(mail.text).toContain("COMPLETED WORK");
    expect(mail.text).not.toContain("Work that finished yesterday");
  });
});
