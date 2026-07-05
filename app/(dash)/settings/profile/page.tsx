import { getActiveProfile } from "@/lib/ai/companyProfile";
import { query } from "@/lib/db";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { shortDate } from "@/lib/format";
import { ProfileEditor } from "@/components/profile-editor";
import { AutomationSettings } from "@/components/automation-settings";
import type { CompanyProfileJson } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ProposedWeightRow {
  id: string;
  version: number;
  rationale: string | null;
  proposed_at: string;
}

export default async function ProfilePage() {
  const profile = await getActiveProfile({ fresh: true });
  const json: CompanyProfileJson | null = profile?.profile_json ?? null;

  const proposed = await query<ProposedWeightRow>(
    `select id, version, rationale, proposed_at
       from scoring_weights
      where approved_at is null and proposed_by = 'learning-loop'
      order by proposed_at desc`
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Company Profile"
        subtitle={
          profile
            ? `Version ${profile.version} · updated ${shortDate(profile.updated_at)}`
            : "No active profile"
        }
      />

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {!json ? (
          <div className="card text-sm text-slate-600">
            No active company profile found. Run{" "}
            <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-800">
              npm run db:seed
            </code>{" "}
            to create the default profile.
          </div>
        ) : (
          <>
            <AutomationSettings
              pursueScore={json.decision_thresholds.pursue_min_score}
              reviewFloor={json.decision_thresholds.review_min_score}
              blockPrimeOnly={json.decision_thresholds.block_prime_only ?? false}
            />
            <ProfileEditor json={json} />
          </>
        )}

        {proposed.length > 0 && (
          <section>
            <h2 className="label mb-2">Proposed scoring weights awaiting approval</h2>
            <div className="space-y-2">
              {proposed.map((w) => (
                <div key={w.id} className="card flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      Version {w.version}
                      <span className="ml-2 text-xs text-slate-500">
                        proposed {shortDate(w.proposed_at)}
                      </span>
                    </p>
                    {w.rationale && (
                      <p className="mt-1 text-xs text-slate-600">{w.rationale}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <ActionButton
                      endpoint={`/api/scoring-weights/${w.id}/approve`}
                      body={{ action: "approve" }}
                      className="btn-success"
                    >
                      Approve
                    </ActionButton>
                    <ActionButton
                      endpoint={`/api/scoring-weights/${w.id}/approve`}
                      body={{ action: "reject" }}
                      className="btn-danger"
                    >
                      Reject
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
