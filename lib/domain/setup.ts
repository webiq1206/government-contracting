/**
 * Setup-completeness checklist. Turns the profile + integration state into a
 * concrete "what's left before the platform runs on its own" list, so a new
 * operator is guided step by step until everything is in place. Pure and
 * unit-tested; the Today page renders whatever this returns.
 */

export interface SetupInputs {
  profile: {
    uei?: string | null;
    cage_code?: string | null;
    naics_codes?: string[] | null;
    service_areas?: string[] | null;
    certifications?: string[] | null;
  } | null;
  integrations: { sam: boolean; claude: boolean; googleMaps: boolean; gmail: boolean };
}

export interface SetupItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
}

export interface SetupChecklist {
  items: SetupItem[];
  done: number;
  total: number;
  complete: boolean;
}

const has = (arr?: string[] | null) => Array.isArray(arr) && arr.length > 0;
const filled = (s?: string | null) => typeof s === "string" && s.trim().length > 0;

const PROFILE_HREF = "/settings/profile";
const INTEGRATIONS_HREF = "/settings/integrations";

export function computeSetupChecklist(i: SetupInputs): SetupChecklist {
  const p = i.profile;
  // The identity item needs BOTH federal identifiers. Say exactly which one is
  // still missing, "Add your UEI and CAGE code" staying open after the UEI was
  // entered reads like a bug when the real gap is the other field.
  const hasUei = filled(p?.uei);
  const hasCage = filled(p?.cage_code);
  const identity: SetupItem = {
    key: "identity",
    label:
      hasUei && !hasCage
        ? "Add your CAGE code (UEI ✓ saved)"
        : !hasUei && hasCage
          ? "Add your UEI (CAGE ✓ saved)"
          : "Add your UEI and CAGE code",
    hint:
      hasUei && !hasCage
        ? "Your UEI is saved. The CAGE code is still blank, both identifiers go on every bid and required form."
        : !hasUei && hasCage
          ? "Your CAGE code is saved. The UEI is still blank, both identifiers go on every bid and required form."
          : "Your federal identifiers go on every bid and required form.",
    done: hasUei && hasCage,
    href: PROFILE_HREF,
  };
  const items: SetupItem[] = [
    identity,
    {
      key: "naics",
      label: "Pick your NAICS codes",
      hint: "The industry codes decide which opportunities fit you and drive scoring.",
      done: has(p?.naics_codes),
      href: PROFILE_HREF,
    },
    {
      key: "service_areas",
      label: "Set your service areas",
      hint: "Where you work, used to judge whether an opportunity is a geographic fit.",
      done: has(p?.service_areas),
      href: PROFILE_HREF,
    },
    {
      key: "certifications",
      label: "List your certifications",
      hint: "Small-business and set-aside certifications unlock the opportunities reserved for them.",
      done: has(p?.certifications),
      href: PROFILE_HREF,
    },
    {
      key: "sam",
      label: "Connect SAM.gov",
      hint: "The source of new federal opportunities. Without it, nothing enters your pipeline.",
      done: i.integrations.sam,
      href: INTEGRATIONS_HREF,
    },
    {
      key: "claude",
      label: "Connect Claude (Anthropic)",
      hint: "Powers scoring, plain-English bid briefs, and call scripts.",
      done: i.integrations.claude,
      href: INTEGRATIONS_HREF,
    },
    {
      key: "googleMaps",
      label: "Connect Google Maps",
      hint: "Finds local subcontractors for each trade automatically.",
      done: i.integrations.googleMaps,
      href: INTEGRATIONS_HREF,
    },
    {
      key: "gmail",
      label: "Connect Gmail",
      hint: "Sends subcontractor outreach and detects their replies.",
      done: i.integrations.gmail,
      href: INTEGRATIONS_HREF,
    },
  ];

  const done = items.filter((it) => it.done).length;
  return { items, done, total: items.length, complete: done === items.length };
}
