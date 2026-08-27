import { assessProfile } from "@/lib/domain/profile-completeness";
import type { CompanyProfileJson } from "@/lib/types";

/**
 * What is still missing from the profile, and what it costs.
 *
 * The profile fails quietly. A missing NAICS code does not raise an error; it
 * produces an empty opportunity feed, and nobody connects the two. A blank
 * outreach address does not raise an error; it produces outreach that never
 * sends. This panel is the connection.
 *
 * Deliberately not a progress bar on its own. A bar says how far along
 * somebody is; it does not say that the next five minutes should go on the UEI
 * rather than the pricing notes, and that is the only useful thing to say.
 */
export function ProfileCompletenessPanel({ json }: { json: CompanyProfileJson }) {
  const state = assessProfile(json);
  const tone =
    state.percent >= 90 ? "text-pursue" : state.percent >= 60 ? "text-review" : "text-risk";

  return (
    <section className="card" aria-labelledby="profile-completeness">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="profile-completeness" className="label">
            Profile completeness
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Weighted by what each field costs, not by how many there are. A profile with a
            legal name and nothing else is not eighty per cent of a bid.
          </p>
        </div>
        <div className={`num text-4xl font-semibold tracking-tight ${tone}`}>
          {state.percent}%
        </div>
      </div>

      {state.invalid.length > 0 && (
        /*
         * Above the missing list, because a wrong value is worse than a blank
         * one: it looks answered, and the thing it breaks breaks somewhere
         * else. A UEI of the wrong length is rejected by the portal, not here.
         */
        <div className="mt-4 rounded-md border border-risk/40 bg-risk/5 p-3">
          <p className="text-xs font-semibold text-risk">
            {state.invalid.length === 1
              ? "One value will not work"
              : `${state.invalid.length} values will not work`}
          </p>
          <ul className="mt-1.5 space-y-1">
            {state.invalid.map((f) => (
              <li key={f.key} className="text-xs leading-relaxed text-foreground">
                <span className="font-medium">{f.label}:</span> {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.nextUp.length > 0 && (
        <div className="mt-4">
          <p className="label mb-1.5">Worth filling in next</p>
          <ul className="space-y-1.5">
            {state.nextUp.map((f) => (
              <li key={f.key} className="text-xs leading-relaxed text-slate-600">
                <span className="font-medium text-slate-800">{f.label}:</span> {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {state.sections.map((s) => (
          <div key={s.key} className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-600">{s.label}</span>
            <span className="flex items-center gap-2">
              <span
                className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                role="presentation"
              >
                <span
                  className={`block h-full rounded-full ${
                    s.percent >= 90 ? "bg-pursue" : s.percent >= 60 ? "bg-review" : "bg-risk"
                  }`}
                  style={{ width: `${s.percent}%` }}
                />
              </span>
              <span className="num w-9 text-right text-xs text-slate-500">{s.percent}%</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
