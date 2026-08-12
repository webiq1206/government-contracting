import { getActiveProfile } from "@/lib/ai/companyProfile";
import { query } from "@/lib/db";
import { PageHeader } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { ActionButton } from "@/components/action-button";
import { shortDate } from "@/lib/format";
import { ProfileEditor } from "@/components/profile-editor";
import { AutomationSettings } from "@/components/automation-settings";
import { EditorialTabs } from "@/components/editorial-tabs";
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

  const approvalsPanel =
    proposed.length > 0 ? (
      <div className="space-y-3 px-5 py-6 sm:px-6">
        <h2 className="font-display text-xl text-foreground">Proposed scoring weights</h2>
        <p className="text-sm text-muted-foreground">
          The Learning Loop suggested these changes. Approve to use them on future scoring, or
          reject to keep the current weights.
        </p>
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
      </div>
    ) : (
      <div className="px-5 py-6 sm:px-6">
        <EmptyState
          title="No weight proposals waiting"
          description="When the Learning Loop suggests new scoring weights, they will show up here for your approval."
        />
      </div>
    );

  return (
    <>
      <PageHeader
        help={PAGE_HELP["profile"]}
        title="Company Profile"
        status={
          profile
            ? `Version ${profile.version} · updated ${shortDate(profile.updated_at)}`
            : "No active profile"
        }
        subtitle="Legal identity, trades, certifications, and scoring thresholds. Scoring and eligibility checks use this as the source of truth."
      />

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        data-guide-target="profile"
        id="profile"
      >
        {!json ? (
          <div className="scroll-thin flex-1 overflow-y-auto p-5">
            <EmptyState
              title="No active company profile"
              description="Run npm run db:seed to create the default profile, or save a new profile below once the editor loads."
            />
          </div>
        ) : (
          <EditorialTabs
            ariaLabel="Company profile sections"
            defaultTab="company"
            layout="fill"
            hashAliases={{
              profile: "company",
              scoring: "scoring",
              thresholds: "scoring",
              approvals: "approvals",
              weights: "approvals",
            }}
            tabs={[
              {
                id: "company",
                label: "Company",
                content: (
                  <div className="space-y-6 px-5 py-6 sm:px-6">
                    <ProfileEditor json={json} />
                  </div>
                ),
              },
              {
                id: "scoring",
                label: "Scoring",
                content: (
                  <div className="space-y-6 px-5 py-6 sm:px-6" id="scoring">
                    <AutomationSettings
                      pursueScore={json.decision_thresholds.pursue_min_score}
                      reviewFloor={json.decision_thresholds.review_min_score}
                      blockPrimeOnly={json.decision_thresholds.block_prime_only ?? false}
                    />
                    <p className="text-xs text-muted-foreground">
                      Pipeline deadline colors and archive retention live under Settings → Rules.
                    </p>
                  </div>
                ),
              },
              {
                id: "approvals",
                label: proposed.length > 0 ? `Approvals (${proposed.length})` : "Approvals",
                content: approvalsPanel,
              },
            ]}
          />
        )}
      </div>
    </>
  );
}
