import { useState, useEffect } from "react";
import { useGetProfile } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";

const EXAMPLE_PROFILE = {
  legal_name: "Acme Contracting LLC",
  ein: "12-3456789",
  cage_code: "",
  uei: "",
  duns: "",
  state_of_incorporation: "CA",
  bonding_capacity: 5000000,
  general_liability_limit: 2000000,
  workers_comp: true,
  naics_codes: ["236220", "237310"],
  trade_categories: ["General Construction", "Civil Works"],
  set_aside_types_held: ["SDVOSB"],
  past_performance: [],
  key_personnel: [{ name: "Owner Name", title: "President", years_experience: 15 }],
  target_states: ["CA", "NV", "AZ"],
  max_contract_value: 10000000,
  min_contract_value: 100000,
  preferred_agency_types: ["DoD", "USACE"],
};

export default function SettingsProfilePage() {
  const { data, isLoading } = useGetProfile();
  const profile = (data as Record<string, unknown> | undefined)?.profile as Record<string, unknown> | null;

  const [json, setJson] = useState("");
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    if (profile?.profile_json) {
      setJson(JSON.stringify(profile.profile_json, null, 2));
    } else {
      setJson(JSON.stringify(EXAMPLE_PROFILE, null, 2));
    }
  }, [!!profile]);

  function validateJson(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.legal_name) {
        setParseError("legal_name is required.");
        return null;
      }
      setParseError("");
      return parsed;
    } catch (e) {
      setParseError((e as SyntaxError).message);
      return null;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Company Profile" subtitle="The scoring engine uses this profile to evaluate bid fit." />
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        {profile && (
          <div className="flex items-center gap-2 rounded-md border border-pursue/30 bg-pursue/5 px-3 py-2">
            <span className="text-pursue">✓</span>
            <span className="text-sm text-slate-200">Profile version {String(profile.version)} active.</span>
          </div>
        )}
        <div className="space-y-2">
          <p className="label">Profile JSON</p>
          <p className="text-xs text-slate-500">
            Edit the JSON below and save. The scoring engine reads this on every evaluation. Required field: <code>legal_name</code>.
          </p>
          <textarea
            className="input h-96 font-mono text-xs"
            value={json}
            onChange={(e) => { setJson(e.target.value); setParseError(""); }}
          />
          {parseError && <p className="text-sm text-risk">{parseError}</p>}
          <ActionButton
            endpoint="/api/profile"
            method="POST"
            body={{ profile_json: validateJson(json) }}
            className="btn-primary"
            onDone={() => {}}
          >
            Save profile
          </ActionButton>
        </div>
        <div className="card bg-ink-950/60 text-sm">
          <p className="label mb-2">Required fields</p>
          <ul className="list-disc space-y-1 pl-4 text-slate-400">
            <li><code>legal_name</code> — company legal name</li>
            <li><code>naics_codes</code> — array of 6-digit NAICS codes you hold</li>
            <li><code>trade_categories</code> — plain-language trade categories</li>
            <li><code>bonding_capacity</code> — max bid bond in dollars</li>
            <li><code>state_of_incorporation</code> — two-letter state code</li>
            <li><code>target_states</code> — array of two-letter state codes you can work in</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
