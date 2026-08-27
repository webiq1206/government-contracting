/**
 * How far this account is from running on its own, in nine stages.
 *
 * Two things were wrong with the list this replaces, and both had the same
 * shape: it reported what had been TYPED rather than what WORKS.
 *
 * A key saved into a form marked its step done. A key can be a typo, an
 * expired credential, or a live key on an account with no credit, and all
 * three read as finished here while the pipeline did nothing. So a step that
 * depends on a service is complete only when that service has answered:
 * either somebody tested it, or it did real work. Anything else is still
 * outstanding, and says which of "never tested" and "refusing" it is.
 *
 * It also stopped three steps short of the workflow. Contact limits, whether
 * the account can pay for what it is about to start doing, and whether a
 * single opportunity has ever been through the pipeline were all absent, so
 * "setup complete" was a claim about credentials rather than about the
 * product working.
 *
 * Every item lands in exactly one of four states. `blocked` is the one that
 * earns its place: a step nobody can act on yet is not the same as one nobody
 * has got to, and a checklist that mixes them sends people to press a button
 * that is not there.
 *
 * Pure and unit-tested; callers render whatever this returns.
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

/** The nine stages, in the order somebody actually goes through them. */
export type SetupStage =
  | "account"
  | "profile"
  | "targeting"
  | "inbox"
  | "ai"
  | "extras"
  | "rules"
  | "access"
  | "first_run";

export const SETUP_STAGE_LABEL: Record<SetupStage, string> = {
  account: "Account and workspace",
  profile: "Company profile and eligibility",
  targeting: "Target work and service area",
  inbox: "Your inbox and who the emails come from",
  ai: "The AI provider",
  extras: "Optional integrations",
  rules: "Automation rules and contact limits",
  access: "Trial or billing access",
  first_run: "Your first opportunity",
};

/**
 * complete  proven, with the evidence named
 * current   actionable right now, and something is waiting on it
 * blocked   cannot be acted on yet, and the reason says why
 * optional  actionable, worth doing, nothing waits on it
 */
export type SetupState = "complete" | "current" | "blocked" | "optional";

export interface SetupItem {
  key: string;
  stage: SetupStage;
  label: string;
  /** Why it matters, stated as the consequence rather than the category. */
  hint: string;
  state: SetupState;
  /** What proved it, past tense. Only ever set on a complete step. */
  evidence?: string;
  /** What is standing in the way. Only ever set on a blocked step. */
  blocker?: string;
  href: string;
  /** state === "complete". Kept because every existing caller reads it. */
  done: boolean;
  /**
   * True when nothing enters the pipeline until this is done.
   *
   * The distinction is not decoration. Several of these steps sharpen
   * results; a few decide whether the product does anything at all, and a new
   * customer previously had no way to tell which was which.
   */
  required: boolean;
  /** A live check that can be run right now, where one exists. */
  test?: { label: string; href: string };
}

/** What proof a credential has of working, from the integration record. */
export interface IntegrationProof {
  /** Every required credential is present. */
  configured: boolean;
  /** The last time it did real work for this account. */
  lastSuccessAt?: string | null;
  /** The last time somebody pressed Test. */
  lastTestedAt?: string | null;
  /** The most recent error, when the last thing it did was fail. */
  lastError?: string | null;
}

export interface SetupInputs {
  /** The organization's name, for the one step that is already done. */
  orgName?: string | null;
  profile: {
    uei?: string | null;
    cage_code?: string | null;
    naics_codes?: string[] | null;
    service_areas?: string[] | null;
    certifications?: string[] | null;
    /** Who the outreach is signed by, and how a subcontractor calls back. */
    owner_name?: string | null;
    company_name?: string | null;
    phone?: string | null;
    outreach_email?: string | null;
    email?: string | null;
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
   * What each credential has actually done, keyed the same as `integrations`.
   *
   * Optional: a caller that cannot supply it gets the old behaviour, where a
   * saved key counts. Every caller in the product supplies it, because the
   * whole point is that a saved key does not count.
   */
  proof?: Partial<Record<"sam" | "claude" | "googleMaps" | "gmail", IntegrationProof>>;
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
  /**
   * Whether somebody has looked at the outreach rules on this account.
   *
   * These decide how often this platform emails other people's businesses on
   * the customer's behalf. The defaults are reasonable and they are still
   * this platform's opinion rather than the customer's, which is the whole
   * argument for putting the step on the list.
   */
  rules?: {
    /** True once the settings row has been written by somebody here. */
    reviewed: boolean;
    /** How many subcontractors one run may contact. */
    outreachBatchLimit?: number | null;
    /** Hours before a follow-up. */
    followupHours?: number | null;
  };
  /** What the account can do, from the one account-status model. */
  access?: {
    level: "full" | "trial" | "none";
    comped?: boolean;
    trialDaysLeft?: number | null;
  };
  /**
   * What has been through the pipeline.
   *
   * Undefined means nobody counted, which is not the same as zero and is
   * rendered as "not known yet" rather than as an empty pipeline.
   */
  firstRun?: {
    opportunities?: number | null;
    scored?: number | null;
    outreachSent?: number | null;
  };
}

export interface SetupChecklist {
  items: SetupItem[];
  done: number;
  total: number;
  complete: boolean;
  /** Required steps still outstanding. Zero means opportunities can flow. */
  requiredRemaining: number;
  /** Steps nobody can act on yet, which is a different queue entirely. */
  blocked: number;
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
const RULES_HREF = "/settings/rules";
const BILLING_HREF = "/settings/billing";

function asDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function on(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * What a credential has proved, and what to say about it.
 *
 * The three outcomes are the point of this function. "Nothing saved" is a
 * step to do. "Saved, never tried" is a step that LOOKS done and is not, and
 * it is the one the old checklist counted as finished. "It failed" is neither
 * of those, and needs the reason rather than a tick.
 */
function credentialState(
  configured: boolean,
  proof: IntegrationProof | undefined
): { proven: boolean; note: string | null; evidence?: string } {
  if (!configured) return { proven: false, note: null };
  // No proof supplied at all: fall back to the old meaning rather than
  // accusing a working account of being untested.
  if (!proof) return { proven: true, note: null, evidence: "A credential is saved." };

  if (proof.lastError) {
    return {
      proven: false,
      note: `The key is saved and the last attempt failed: ${proof.lastError.slice(0, 160)}`,
    };
  }
  const used = asDate(proof.lastSuccessAt ?? null);
  const tested = asDate(proof.lastTestedAt ?? null);
  if (used && (!tested || used >= tested)) {
    return { proven: true, note: null, evidence: `It did real work on ${on(used)}.` };
  }
  if (tested) {
    return { proven: true, note: null, evidence: `Tested on ${on(tested)}.` };
  }
  return {
    proven: false,
    note: "The key is saved and nothing has used it yet, so whether it works is still unknown. Test it and this step finishes.",
  };
}

/** current when something waits on it, optional when nothing does. */
function pending(required: boolean): SetupState {
  return required ? "current" : "optional";
}

export function computeSetupChecklist(i: SetupInputs): SetupChecklist {
  const p = i.profile;
  const items: SetupItem[] = [];

  /* 1. The account itself, which is finished by definition: whoever is
   *    reading this signed in to get here. On the list anyway, because a
   *    checklist that starts at step two makes somebody wonder what they
   *    missed. */
  items.push({
    key: "account",
    stage: "account",
    label: "Your account and workspace",
    hint: "The organization every record on this platform belongs to.",
    state: "complete",
    evidence: filled(i.orgName)
      ? `You are signed in to ${i.orgName!.trim()}.`
      : "You are signed in.",
    href: "/settings/account",
    done: true,
    required: true,
  });

  /* 2. Discovery: the source, and the codes it searches with. Adjacent on
   *    purpose. Neither works alone, and splitting them across the list is
   *    what let somebody connect SAM, see an empty pipeline, and have no idea
   *    the missing NAICS codes were the reason. */
  const sam = credentialState(i.integrations.sam, i.proof?.sam);
  items.push({
    key: "sam",
    stage: "targeting",
    label: "Connect SAM.gov",
    hint:
      sam.note ??
      integrationHint(
        "sam",
        "The source of every federal opportunity. Until this is connected, your pipeline stays empty."
      ),
    state: sam.proven ? "complete" : "current",
    evidence: sam.evidence,
    href: INTEGRATIONS_HREF,
    done: sam.proven,
    required: true,
    test: { label: "Test SAM.gov", href: INTEGRATIONS_HREF },
  });

  const hasNaics = has(p?.naics_codes);
  items.push({
    key: "naics",
    stage: "targeting",
    label: "Pick your NAICS codes",
    hint:
      i.integrations.sam && !hasNaics
        ? "SAM.gov is connected but searches cannot run without these. Your industry codes are what Brost Co searches on, one code at a time."
        : "Your industry codes are what Brost Co searches SAM.gov with, and what scoring judges fit against. Nothing is found without them.",
    state: hasNaics ? "complete" : "current",
    evidence: hasNaics
      ? `${p!.naics_codes!.length} code${p!.naics_codes!.length === 1 ? "" : "s"} saved.`
      : undefined,
    href: PROFILE_HREF,
    done: hasNaics,
    required: true,
  });

  const hasAreas = has(p?.service_areas);
  items.push({
    key: "service_areas",
    stage: "targeting",
    label: "Set your service areas",
    hint: "Where you work, used to judge whether an opportunity is a geographic fit and to find subcontractors near it.",
    state: hasAreas ? "complete" : "optional",
    evidence: hasAreas
      ? `${p!.service_areas!.length} area${p!.service_areas!.length === 1 ? "" : "s"} saved.`
      : undefined,
    href: PROFILE_HREF,
    done: hasAreas,
    required: false,
  });

  /* 3. Who you are on paper. Needed before a bid can be submitted, not
   *    before opportunities arrive, so neither of these blocks the pipeline. */
  const hasUei = filled(p?.uei);
  const hasCage = filled(p?.cage_code);
  const identityDone = hasUei && hasCage;
  items.push({
    key: "identity",
    stage: "profile",
    label:
      hasUei && !hasCage
        ? "Add your CAGE code"
        : !hasUei && hasCage
          ? "Add your UEI"
          : "Add your UEI and CAGE code",
    hint:
      hasUei && !hasCage
        ? "Your UEI is saved. The CAGE code is still blank, and both identifiers go on every bid and required form."
        : !hasUei && hasCage
          ? "Your CAGE code is saved. The UEI is still blank, and both identifiers go on every bid and required form."
          : "Your federal identifiers go on every bid and required form.",
    state: identityDone ? "complete" : "optional",
    evidence: identityDone ? "Both identifiers are saved." : undefined,
    href: PROFILE_HREF,
    done: identityDone,
    required: false,
  });

  const hasCerts = has(p?.certifications);
  items.push({
    key: "certifications",
    stage: "profile",
    label: "List your certifications",
    hint: "Small-business and set-aside certifications unlock the opportunities reserved for them.",
    state: hasCerts ? "complete" : "optional",
    evidence: hasCerts
      ? `${p!.certifications!.length} recorded.`
      : undefined,
    href: PROFILE_HREF,
    done: hasCerts,
    required: false,
  });

  /* 4. The inbox, and who the emails are from. Two steps rather than one:
   *    a connected mailbox with nobody's name on the message still cannot
   *    send, because the send path refuses a template it cannot fill. */
  const gmailOffered = i.gmailOffered !== false;
  const inbox = credentialState(i.integrations.gmail, i.proof?.gmail);
  const inboxDone = gmailOffered && inbox.proven;
  items.push({
    key: "email",
    stage: "inbox",
    label: "Connect your Google inbox",
    hint: !gmailOffered
      ? "Until one is connected, outreach cannot send from your own address."
      : (inbox.note ??
        "Sends subcontractor outreach from your own address and reads their replies back into the record."),
    state: inboxDone ? "complete" : !gmailOffered ? "blocked" : "current",
    evidence: inboxDone ? (inbox.evidence ?? "A mailbox is connected.") : undefined,
    blocker: gmailOffered
      ? undefined
      : "This deployment has no Google connection configured, so no inbox can be connected here yet. Ask whoever administers it.",
    href: INTEGRATIONS_HREF,
    done: inboxDone,
    required: true,
  });

  /*
   * The identity on the message.
   *
   * Every one of these is a variable the outreach template fills, and the
   * send path refuses rather than sending an email with a blank where a name
   * should be. That refusal happens at 3am inside the outreach agent, where
   * nobody sees it, which is exactly why the gap belongs on this list.
   */
  const senderMissing: string[] = [];
  if (!filled(p?.company_name)) senderMissing.push("your company name");
  if (!filled(p?.owner_name)) senderMissing.push("who signs the emails");
  if (!filled(p?.phone)) senderMissing.push("a callback number");
  if (!filled(p?.outreach_email) && !filled(p?.email)) senderMissing.push("an outreach address");
  const senderDone = senderMissing.length === 0;
  items.push({
    key: "sender_identity",
    stage: "inbox",
    label: senderDone ? "Say who the emails come from" : `Add ${senderMissing.join(", ")}`,
    hint: senderDone
      ? "The name, address and number a subcontractor sees on every message."
      : "Outreach is refused rather than sent with a blank where a name should be, and that refusal happens overnight where nobody sees it.",
    state: senderDone ? "complete" : "current",
    evidence: senderDone ? "Every field the outreach emails fill is present." : undefined,
    href: PROFILE_HREF,
    done: senderDone,
    required: true,
  });

  /* 5. The AI provider, which is what turns a list of notices into a
   *    pipeline. Borrowed during the trial, so it is due before the trial
   *    ends rather than immediately. */
  const claude = credentialState(i.integrations.claude, i.proof?.claude);
  items.push({
    key: "claude",
    stage: "ai",
    label: i.onTrial
      ? "Add your Anthropic (Claude) key before the trial ends"
      : "Add your Anthropic (Claude) key",
    hint:
      claude.note ??
      integrationHint("claude", "Powers scoring, plain-English bid briefs, and call scripts."),
    state: claude.proven ? "complete" : pending(!i.onTrial),
    evidence: claude.evidence,
    href: INTEGRATIONS_HREF,
    done: claude.proven,
    required: !i.onTrial,
    test: { label: "Run a live test", href: INTEGRATIONS_HREF },
  });

  /* 6. The optional ones. Named optional here rather than left to look like
   *    a chore somebody forgot. */
  const maps = credentialState(i.integrations.googleMaps, i.proof?.googleMaps);
  items.push({
    key: "googleMaps",
    stage: "extras",
    label: i.onTrial
      ? "Add your Google Maps key before the trial ends"
      : "Add your Google Maps key",
    hint:
      maps.note ??
      integrationHint("googleMaps", "Finds local subcontractors for each trade automatically."),
    state: maps.proven ? "complete" : pending(!i.onTrial),
    evidence: maps.evidence,
    href: INTEGRATIONS_HREF,
    done: maps.proven,
    required: !i.onTrial,
    test: { label: "Run a live test", href: INTEGRATIONS_HREF },
  });

  /* 7. The rules about contacting other people's businesses. */
  const rulesReviewed = i.rules?.reviewed === true;
  const limitNote =
    i.rules?.outreachBatchLimit != null
      ? `Right now one run may contact up to ${i.rules.outreachBatchLimit} subcontractor${i.rules.outreachBatchLimit === 1 ? "" : "s"}` +
        (i.rules?.followupHours != null
          ? `, and follows up after ${i.rules.followupHours} hour${i.rules.followupHours === 1 ? "" : "s"}.`
          : ".")
      : "These limits decide how many businesses this platform contacts on your behalf, and how soon it follows up.";
  items.push({
    key: "rules",
    stage: "rules",
    label: rulesReviewed ? "Automation rules and contact limits" : "Set your contact limits",
    hint: rulesReviewed
      ? limitNote
      : `${limitNote} They are on this platform's defaults until you look at them, and they are sent under your company's name.`,
    state: rulesReviewed ? "complete" : "optional",
    evidence: rulesReviewed ? "Reviewed and saved on this account." : undefined,
    href: RULES_HREF,
    done: rulesReviewed,
    required: false,
  });

  /* 8. Whether the account can pay for what it is about to start doing. */
  if (i.access) {
    const a = i.access;
    const ok = a.level === "full";
    const trialing = a.level === "trial";
    items.push({
      key: "access",
      stage: "access",
      label: ok ? "Billing access" : trialing ? "Choose a plan before the trial ends" : "Restore access",
      hint: ok
        ? a.comped
          ? "This account has been given full access. There is nothing to pay."
          : "The subscription is active, so nothing here is metered."
        : trialing
          ? a.trialDaysLeft != null
            ? `The trial has ${a.trialDaysLeft} day${a.trialDaysLeft === 1 ? "" : "s"} left. A few actions are metered until a plan is chosen; everything else is already running.`
            : "A few actions are metered during the trial. Choosing a plan lifts every limit."
          : "Nothing runs without access. Nothing has been deleted, and one payment brings it all back.",
      state: ok ? "complete" : trialing ? "optional" : "current",
      evidence: ok
        ? a.comped
          ? "Full access, no billing required."
          : "The subscription is active."
        : undefined,
      href: BILLING_HREF,
      done: ok,
      required: a.level === "none",
    });
  }

  /* 9. Whether any of it has actually happened yet.
   *
   *    Deliberately last and deliberately not required: it is the step the
   *    platform finishes on the customer's behalf once the ones above are
   *    done, and it is the only honest answer to "is this thing working".
   */
  const found = i.firstRun?.opportunities;
  const foundKnown = typeof found === "number";
  const discoveryReady = sam.proven && hasNaics;
  const firstDone = foundKnown && found > 0;
  items.push({
    key: "first_opportunity",
    stage: "first_run",
    label: firstDone ? "Your first opportunity" : "Wait for your first opportunity",
    hint: firstDone
      ? `${found} opportunit${found === 1 ? "y has" : "ies have"} come in. Open one and the guided plan walks the whole workflow, from scoring to a submitted bid.`
      : !foundKnown
        ? "Not counted yet."
        : discoveryReady
          ? "Discovery is set up and the next run will search on your codes. Nothing else is needed from you for this one."
          : "Opportunities arrive on their own once discovery above is finished. Nothing here needs doing by hand.",
    state: firstDone
      ? "complete"
      : discoveryReady
        ? "optional"
        : "blocked",
    evidence: firstDone
      ? typeof i.firstRun?.outreachSent === "number" && i.firstRun.outreachSent > 0
        ? `${found} found, and outreach has gone out on ${i.firstRun.outreachSent}.`
        : `${found} found.`
      : undefined,
    blocker: firstDone || discoveryReady
      ? undefined
      : "Nothing can be found until SAM.gov is connected and your NAICS codes are saved.",
    href: "/opportunities",
    done: firstDone,
    required: false,
  });

  const done = items.filter((it) => it.done).length;
  return {
    items,
    done,
    total: items.length,
    complete: done === items.length,
    requiredRemaining: items.filter((it) => it.required && !it.done).length,
    blocked: items.filter((it) => it.state === "blocked").length,
    discoveryStalled: i.integrations.sam && !hasNaics,
  };
}
