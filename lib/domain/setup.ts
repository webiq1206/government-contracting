/**
 * Setup-completeness checklist. Turns the profile + integration state into a
 * concrete "what's left before the platform runs on its own" list, so a new
 * operator is guided step by step until everything is in place. Pure and
 * unit-tested; the Today page renders whatever this returns.
 */

import { INTEGRATION_DEFS } from "../integration-defs";

/**
 * The plain-English "why" for an integration step, taken from the same catalog
 * the Integrations page renders.
 *
 * Every customer supplies their own credentials, so onboarding has to justify
 * each one rather than just name it: what it does, what breaks without it, and
 * what it costs. Reading that from one catalog means the checklist and the
 * settings page can never drift into saying different things.
 */
function integrationHint(id: string, fallback: string): string {
  const def = INTEGRATION_DEFS.find((d) => d.id === id);
  if (!def) return fallback;
  const cost = def.guide?.cost ? ` ${def.guide.cost}` : "";
  return `${def.what} Without it, ${def.without.charAt(0).toLowerCase()}${def.without.slice(1)}${cost}`;
}

export interface SetupInputs {
  profile: {
    uei?: string | null;
    cage_code?: string | null;
    naics_codes?: string[] | null;
    service_areas?: string[] | null;
    certifications?: string[] | null;
  } | null;
  integrations: {
    sam: boolean;
    claude: boolean;
    googleMaps: boolean;
    /**
     * Whether THIS account has a mailbox connected and working.
     *
     * Not whether the deployment has Google OAuth credentials. It was the
     * latter, which is a property of the platform shared by every customer, so
     * the step read "done" for a brand-new account that had never connected an
     * inbox and could not send a single outreach email. "Connected" has to
     * mean the thing works, and for a mailbox that is a live grant on this
     * organization.
     */
    gmail: boolean;
  };
  /**
   * Whether the deployment can offer a Google connection at all.
   *
   * Absent OAuth credentials the step is impossible rather than outstanding,
   * and an operator can spend a long time looking for a button that is not
   * there. Defaults to true, which is the state of any deployment that has
   * ever connected an inbox.
   */
  gmailOffered?: boolean;
  /**
   * True while the organization is on its free trial.
   *
   * During the trial the platform lends its Anthropic and Google Maps keys, so
   * those two steps are needed before the trial ends rather than before the
   * product works. Saying "Required" on day one would be false, and a checklist
   * that overstates urgency stops being read.
   */
  onTrial?: boolean;
}

export interface SetupItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
  /**
   * True when nothing enters the pipeline until this is done.
   *
   * The distinction is not decoration. Four of these steps sharpen results;
   * two decide whether the product does anything at all, and a new customer
   * previously had no way to tell which was which.
   */
  required: boolean;
}

export interface SetupChecklist {
  items: SetupItem[];
  done: number;
  total: number;
  complete: boolean;
  /** Required steps still outstanding. Zero means opportunities can flow. */
  requiredRemaining: number;
  /**
   * Set when the SAM.gov key is connected but no NAICS codes are saved.
   *
   * This pairing is a silent trap: the monitor skips federal ingestion
   * entirely when NAICS is empty, logging a warning nobody reads. The customer
   * sees a connected integration and an empty pipeline, with no visible link
   * between the two. Surfaced here so the UI can say it out loud.
   */
  discoveryStalled: boolean;
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
    // Needed before a bid can be submitted, not before opportunities arrive.
    required: false,
  };
  const hasNaics = has(p?.naics_codes);

  /**
   * Order is the product's opinion about what to do first, so it follows the
   * dependency chain rather than the shape of the settings pages.
   *
   * SAM.gov and NAICS come first because they decide whether anything
   * happens at all: the monitor polls SAM once per NAICS code and skips
   * federal ingestion outright when either is missing. The Anthropic and
   * Google Maps keys are required too, because without them the product is a
   * list of notices rather than a system: nothing is scored, no brief is
   * written, and no subcontractor is found. The previous order walked a new
   * customer through four profile fields before reaching any of it.
   *
   * They are adjacent on purpose. Neither works alone, and splitting them
   * across the list is what let someone connect SAM, see an empty pipeline,
   * and have no idea the missing NAICS codes were the reason.
   */
  const items: SetupItem[] = [
    {
      key: "sam",
      label: "Add your SAM.gov API key",
      hint: integrationHint(
        "sam",
        "The source of every federal opportunity. Until this is connected, your pipeline stays empty."
      ),
      done: i.integrations.sam,
      href: INTEGRATIONS_HREF,
      required: true,
    },
    {
      key: "naics",
      label: "Pick your NAICS codes",
      hint: i.integrations.sam && !hasNaics
        ? "SAM.gov is connected but searches cannot run without these. Your industry codes are what Brost Co searches on, one code at a time."
        : "Your industry codes are what Brost Co searches SAM.gov with, and what scoring judges fit against. Nothing is found without them.",
      done: hasNaics,
      href: PROFILE_HREF,
      required: true,
    },
    {
      key: "service_areas",
      label: "Set your service areas",
      hint: "Where you work, used to judge whether an opportunity is a geographic fit.",
      done: has(p?.service_areas),
      href: PROFILE_HREF,
      required: false,
    },
    identity,
    {
      key: "certifications",
      label: "List your certifications",
      hint: "Small-business and set-aside certifications unlock the opportunities reserved for them.",
      done: has(p?.certifications),
      href: PROFILE_HREF,
      required: false,
    },
    {
      key: "claude",
      label: i.onTrial
        ? "Add your Anthropic (Claude) key before the trial ends"
        : "Add your Anthropic (Claude) key",
      hint: integrationHint(
        "claude",
        "Powers scoring, plain-English bid briefs, and call scripts."
      ),
      done: i.integrations.claude,
      href: INTEGRATIONS_HREF,
      // Borrowed during the trial, mandatory to keep afterwards.
      required: !i.onTrial,
    },
    {
      key: "googleMaps",
      label: i.onTrial
        ? "Add your Google Maps key before the trial ends"
        : "Add your Google Maps key",
      hint: integrationHint(
        "googleMaps",
        "Finds local subcontractors for each trade automatically."
      ),
      done: i.integrations.googleMaps,
      href: INTEGRATIONS_HREF,
      required: !i.onTrial,
    },
    {
      // The connected inbox is the whole email system: it sends outreach, and
      // it is the mailbox we sync replies back out of.
      key: "email",
      label: "Connect your Google inbox",
      hint:
        i.gmailOffered === false
          ? "This deployment has no Google connection configured, so no inbox can be connected here yet. Until one is, outreach cannot send from your own address. Ask whoever administers this deployment."
          : "Sends subcontractor outreach from your own address and reads their replies back into the record.",
      done: i.gmailOffered === false ? false : i.integrations.gmail,
      href: INTEGRATIONS_HREF,
      required: false,
    },
  ];

  const done = items.filter((it) => it.done).length;
  return {
    items,
    done,
    total: items.length,
    complete: done === items.length,
    requiredRemaining: items.filter((it) => it.required && !it.done).length,
    discoveryStalled: i.integrations.sam && !hasNaics,
  };
}
