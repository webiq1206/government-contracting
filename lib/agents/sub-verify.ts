/**
 * SUB VERIFY, triggered per candidate by Sub Finder.
 * Enriches and vets a single subcontractor: finds + verifies a contact email
 * (Hunter), fills in a missing phone (Google Place Details), records license
 * status (no state-license API exists yet, kept 'unknown' with a note that the
 * state scraper still owes this), checks SAM exclusions, and records the saved
 * Google rating/review-count signal. Findings are written back to the subcontractors row and
 * the opportunity_subs verification record. Subs that clear our standards are
 * handed to Outreach.
 */
import { query, queryOne } from "../db";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { googleMaps } from "../integrations/googleMaps";
import { hunter } from "../integrations/hunter";
import { scrapeWebsiteEmailDetailed, domainHasMx } from "../integrations/email-scrape";
import { findWebsiteBysearch } from "../integrations/website-finder";
import { sam } from "../integrations/sam";
import { hasContactPathway, isEmailable } from "../domain/sub-contactability";
import { areCallsEnabled, getWorkExecution } from "../app-settings";
import { outreachAllowed } from "../domain/work-mode";
import { currentOrgId } from "../tenant-context";
import { backfillPublicContact } from "../public-contact-backfill";
import type { AgentDefinition } from "./types";
import type { AgentResult, Subcontractor } from "../types";
import { fitContext, fitSendBlock, type FitContextInput } from "../domain/subcontractor-fit";

/** Pull a bare domain out of a website URL. */
function domainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.includes("://") ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Prefer emails whose position looks like owner/estimating, then confidence. */
function pickBestEmail(
  emails: { value: string; confidence: number; position?: string }[]
): { value: string; confidence: number } | null {
  if (!emails.length) return null;
  const scored = emails
    .map((e) => {
      const pos = (e.position ?? "").toLowerCase();
      const role =
        /owner|principal|president|estimat|founder|ceo/.test(pos) ? 1 : 0;
      return { e, role };
    })
    .sort((a, b) => b.role - a.role || b.e.confidence - a.e.confidence);
  return { value: scored[0].e.value, confidence: scored[0].e.confidence };
}

export const subVerify: AgentDefinition = {
  name: "sub-verify",
  label: "Sub Verify",
  description:
    "Enriches + vets a candidate sub: verifies email, fills phone, checks SAM exclusions, records Google signals, then routes qualifying subs to Outreach.",
  worksWithoutClaude: true, // enrichment and verification do not require an LLM
  async handler(ctx): Promise<AgentResult> {
    const opportunityId = ctx.payload.opportunityId as string;
    const subcontractorId = ctx.payload.subcontractorId as string;
    const trade = ctx.payload.trade as string | undefined;
    if (!opportunityId || !subcontractorId)
      return { ok: false, summary: "missing opportunityId or subcontractorId in payload" };

    const orgId = currentOrgId();
    if (!orgId) {
      await logAgent({
        agent: "sub-verify",
        action: "tenant-context-refused",
        level: "error",
        status: "error",
        message:
          "Verification stopped because the job has no organization context. No record or external provider was accessed.",
      });
      return {
        ok: false,
        summary:
          "Verification stopped because the job has no organization context. Repair the queued job, then retry.",
        humanActionRequired: true,
      };
    }

    const owner = await queryOne<FitContextInput & { org_id: string | null; work_mode?: string | null }>(
      `select id,org_id,location_state,location_text,solicitation_analysis,description,work_mode
         from opportunities where id=$1 and org_id=$2`,
      [opportunityId, orgId]
    );
    const sub = await queryOne<Subcontractor & { service_area_states?: string[] | null }>(
      `select * from subcontractors where id = $1 and org_id = $2`,
      [subcontractorId, orgId]
    );
    if (!owner || !sub) {
      await logAgent({
        agent: "sub-verify",
        action: "tenant-ownership-refused",
        level: "error",
        status: "error",
        message:
          "Verification stopped because the opportunity or subcontractor is not visible in the job organization. No external lookup was made.",
      });
      return {
        ok: false,
        summary:
          "Verification stopped because a required record is missing from this organization. Repair the queued record references, then retry.",
        humanActionRequired: true,
      };
    }

    if (sub.archived_at) return { ok: true, summary: "Contact research skipped because this firm is archived." };
    // Read off the row just loaded: a verification queued before the switch
    // must not contact anybody when it finally runs.
    if (!outreachAllowed(await getWorkExecution(), owner)) {
      return { ok: true, summary: "Subcontractor outreach is off for this opportunity (it is self-performed), so nothing was verified or contacted." };
    }

    if (ctx.payload.publicContactOnly === true) return backfillPublicContact(orgId, opportunityId, sub, trade);

    // A search category, nearby address or working mailbox cannot establish
    // actual capability/coverage. Require saved source review before enrichment
    // spends or any handoff to Outreach. Older candidates remain reviewable.
    const fit = await queryOne<{ verification_json: unknown; outreach_state: string | null }>(
      `select verification_json,outreach_state from opportunity_subs
        where opportunity_id=$1 and subcontractor_id=$2 and org_id=$3
          and coalesce(trade,'')=coalesce($4::text,'') and removed_at is null`,
      [opportunityId,subcontractorId,orgId,trade ?? null]);
    if (!fit) return {ok:true,summary:"The active request was not found. Verification did not queue outreach."};
    const { isClosedOutreach } = await import("../domain/decline-closeout");
    if (fit && isClosedOutreach(fit.outreach_state)) {
      return {ok:true,summary:"This request is closed. Verification did not reopen it or queue outreach."};
    }
    const fitBlock = fitSendBlock(fit?.verification_json,fitContext(owner,subcontractorId,trade));
    if (fitBlock) {
      await query(`update opportunity_subs set verified=false,
          outreach_state=case when outreach_state in ('pending','draft','email_unverified','send_failed')
            then 'held' else outreach_state end,
          verification_json=coalesce(verification_json,'{}'::jsonb) || jsonb_build_object('fit_hold',$5::text)
        where opportunity_id=$1 and subcontractor_id=$2 and org_id=$3
          and coalesce(trade,'')=coalesce($4::text,'')`,
        [opportunityId,subcontractorId,orgId,trade ?? null,fitBlock]);
      await query(`update opportunities set human_action_required=true where id=$1 and org_id=$2`,[opportunityId,orgId]);
      await logAgent({agent:"sub-verify",action:"fit-review-required",level:"warn",status:"skipped",
        opportunityId,subcontractorId,message:fitBlock});
      return {ok:true,humanActionRequired:true,summary:fitBlock,data:{passes:false,route:"held (fit review required)"}};
    }

    const profile = await getProfileJson();
    const std = profile?.sub_standards;

    const notes: string[] = [];
    const verification: Record<string, unknown> = {};
    const unresolvedFailures: string[] = [];

    // The source-reviewed fit above supersedes address proximity. A supplier
    // may work across state lines; neither a nearby nor a distant office can
    // override its reviewed project-specific service coverage.
    verification.fit_hold = null;

    // --- Website + phone enrichment via Google Place Details ---
    // Nearly all subs arrive from Places text search with a place_id but no
    // website; Place Details is the one call that recovers both website and
    // phone, and the website is the anchor for all email discovery below.
    let website: string | null = (sub as { website?: string | null }).website ?? null;
    let phone: string | null = sub.phone ?? null;
    const placeId = (sub as { google_place_id?: string | null }).google_place_id ?? null;
    if ((!website || !phone) && placeId) {
      const details = await googleMaps.placeDetails(placeId);
      if (details) {
        if (!website && details.website) website = details.website;
        if (!phone && details.phone) phone = details.phone;
      } else {
        const message =
          "Google Maps Place Details was unavailable or empty, so missing website or phone data remains unverified.";
        notes.push(message);
        unresolvedFailures.push(message);
      }
    }

    // Key-free fallback: find the website via free web search (company name +
    // city/state), sanity-checked so the wrong company's site is never saved.
    if (!website) {
      website = await findWebsiteBysearch({
        companyName: sub.company_name,
        city: sub.city ?? null,
        state: sub.state ?? null,
      });
      if (website) {
        notes.push(`Website discovered via web search: ${website}.`);
      } else {
        const message =
          "Web-search website lookup was inconclusive. No website was recorded, and this must not be treated as proof that no website exists.";
        notes.push(message);
        unresolvedFailures.push(message);
      }
    }

    // --- Email discovery + verification ---
    // Ladder: Hunter (domain search / name guess) → website scrape fallback.
    // Verification: Hunter SMTP-level verify when available, else DNS MX check.
    let email: string | null = sub.email ?? null;
    let emailVerified = sub.email_verified ?? false;
    let emailSource: string | null = (sub as { email_source?: string | null }).email_source ?? null;
    const domain = domainOf(website);

    if (!email) {
      if (domain) {
        const ds = await hunter.domainSearch(domain);
        if (ds.disabled) {
          notes.push("Hunter disabled, skipping Hunter email discovery.");
        } else if (ds.error) {
          // Unknown, not negative: a failed lookup must never be recorded as
          // "no contact email exists".
          notes.push(`Hunter lookup failed (${ds.error}); email discovery is unknown, not exhausted.`);
          unresolvedFailures.push(`Hunter domain search failed: ${ds.error}`);
          await logAgent({
            agent: "sub-verify",
            action: "hunter-error",
            level: "error",
            status: "error",
            opportunityId,
            subcontractorId,
            message: `Hunter domain search failed for ${domain}: ${ds.error}. If this repeats, test the Hunter key in Settings, then Integrations.`,
          });
        } else {
          const best = pickBestEmail(ds.emails);
          if (best) {
            email = best.value;
            emailSource = "hunter";
            const v = await hunter.verifyEmail(best.value);
            if (v.error) {
              notes.push(`Hunter could not verify ${best.value} (${v.error}); left unverified.`);
              unresolvedFailures.push(`Hunter could not verify ${best.value}: ${v.error}`);
            }
            emailVerified = v.status === "valid";
            verification.email_confidence = best.confidence;
            verification.email_status = v.status ?? (v.error ? "verify_failed" : null);
          }
        }
      } else {
        // No website domain, try to guess from the company name.
        const fe = await hunter.findEmail({ company: sub.company_name, domain: "" });
        if (fe.disabled) {
          notes.push("Hunter disabled, skipping Hunter email discovery.");
        } else if (fe.error) {
          const message = `Hunter company search failed (${fe.error}); email discovery is unknown, not exhausted.`;
          notes.push(message);
          unresolvedFailures.push(message);
          await logAgent({
            agent: "sub-verify",
            action: "hunter-error",
            level: "error",
            status: "error",
            opportunityId,
            subcontractorId,
            message: `${message} Test the Hunter key in Settings, then Integrations, and retry verification.`,
          });
        } else if (fe.email) {
          email = fe.email;
          emailSource = "hunter";
          const v = await hunter.verifyEmail(fe.email);
          if (v.error) {
            const message = `Hunter could not verify ${fe.email} (${v.error}); left unverified.`;
            notes.push(message);
            unresolvedFailures.push(message);
          }
          emailVerified = v.status === "valid";
          verification.email_status = v.status ?? null;
        }
      }
    }

    // Key-free fallback: the sub's own site usually publishes a contact email.
    if (!email && website) {
      let scraped: Awaited<ReturnType<typeof scrapeWebsiteEmailDetailed>>["email"] = null;
      let pagesRead = 0;
      try {
        ({ email: scraped, pagesRead } = await scrapeWebsiteEmailDetailed(website));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown website crawl error";
        const message = `Website email crawl failed (${reason}); email discovery remains incomplete.`;
        notes.push(message);
        unresolvedFailures.push(message);
        await logAgent({
          agent: "sub-verify",
          action: "website-email-error",
          level: "error",
          status: "error",
          opportunityId,
          subcontractorId,
          message: `${message} Check website access and retry verification.`,
        });
      }
      if (scraped) {
        email = scraped.email;
        emailSource = scraped.sourceType === "linked_social" ? "linked_public_profile" : "website_scrape";
        verification.email_discovery = {
          email: scraped.email,
          source_url: scraped.sourceUrl ?? null,
          source_type: scraped.sourceType ?? "website",
          checked_at: scraped.checkedAt ?? new Date().toISOString(),
        };
        // Prefer Hunter's SMTP-level verify when configured. Without Hunter,
        // policy (operator-approved): an address published on the sub's OWN
        // website whose domain accepts mail (MX) is treated as sendable —
        // the sub itself asks to be contacted there. Free-mail / off-domain
        // or MX-missing finds stay unverified drafts for operator approval.
        const v = scraped.sourceType === "linked_social"
          ? { disabled: true, error: undefined, status: undefined }
          : await hunter.verifyEmail(scraped.email);
        if (!v.disabled && !v.error) {
          emailVerified = v.status === "valid";
          verification.email_status = v.status ?? null;
        } else {
          const mxOk = await domainHasMx(scraped.email);
          emailVerified = mxOk && scraped.ownDomain;
          verification.email_status = emailVerified
            ? "scraped_own_domain_mx_ok"
            : mxOk
              ? "mx_ok_unverified"
              : "mx_missing";
          notes.push(
            emailVerified
              ? "Email published on the sub's own website and its domain accepts mail, treated as sendable."
              : mxOk
                ? "Email scraped from website is off-domain (free-mail or third party); kept as a draft for operator approval."
                : "Email scraped from website but its domain has no MX records; likely undeliverable."
          );
        }
        verification.email_own_domain = scraped.ownDomain;
      } else if (pagesRead > 0) {
        // The firm's own pages were read and publish no address. That is an
        // answer, not a failure: another crawl reads the same pages.
        notes.push(`The website was read (${pagesRead} page${pagesRead === 1 ? "" : "s"}) and publishes no usable email.`);
      } else if (!unresolvedFailures.some((failure) => failure.startsWith("Website email crawl failed"))) {
        const message =
          "The website crawl could not read any of the firm's pages, so whether it publishes an email is unknown.";
        notes.push(message);
        unresolvedFailures.push(message);
      }
    }

    // Explicit contactability outcome — "no email" must never be silent.
    const contactStatus = email
      ? emailVerified
        ? "verified"
        : "unverified"
      : unresolvedFailures.length > 0
        ? "discovery_incomplete"
        : website
          ? "no_email_found"
          : "no_website";
    if (!email) {
      notes.push(
        website
          ? "No contact email was confirmed. Automated discovery is incomplete and needs review or retry."
          : "No website was confirmed, so email discovery is incomplete and needs review or retry."
      );
    }

    // --- License status: no state-license API yet ---
    const licenseStatus = sub.license_status ?? "unknown";
    if (licenseStatus === "unknown") {
      notes.push("License status unverified, needs the state license-board scraper.");
    }
    verification.license_status = licenseStatus;

    // --- SAM exclusions ---
    let samExcluded = sub.sam_excluded ?? false;
    // True only when the exclusion status is actually CONFIRMED this run. An
    // API error must not let an unchecked sub through to outreach, that's a
    // debarment false negative. (Column is NOT NULL default false, so the
    // stored value alone can't distinguish "checked clear" from "never checked".)
    let samConfirmed = false;
    let samBudgetSpent = false;
    // One firm is paired with many solicitations. A confirmed result from the
    // last 30 days answers the question; asking SAM again for every pairing
    // spent the account's daily call budget and held every send behind it.
    let recentSam: { excluded: boolean; checked_at: string } | null = null;
    try {
      recentSam = (await queryOne<{ excluded: boolean; checked_at: string }>(
      `select (verification_json->>'sam_excluded')::boolean as excluded,
              verification_json->>'sam_checked_at' as checked_at
         from opportunity_subs
        where subcontractor_id = $1 and org_id = $2
          and verification_json->>'sam_confirmed' = 'true'
          and (verification_json->>'sam_checked_at')::timestamptz > now() - interval '30 days'
        order by (verification_json->>'sam_checked_at')::timestamptz desc
        limit 1`,
      [subcontractorId, orgId]
    )) ?? null;
    } catch {
      // A lookup that cannot run just means asking SAM, as before.
      recentSam = null;
    }
    if (typeof recentSam?.excluded !== "boolean" || !recentSam.checked_at) recentSam = null;
    const excl = recentSam
      ? { excluded: recentSam.excluded, reused: true as const }
      : await sam.isExcluded(sub.company_name, orgId);
    if ("disabled" in excl && excl.disabled) {
      if (excl.disabledReason === "quota_exhausted") {
        samBudgetSpent = true;
        notes.push(
          "SAM exclusions check could not run because today's account call budget is exhausted. Outreach is held until a later verification confirms the result."
        );
        unresolvedFailures.push("SAM exclusions check could not run because the account call budget is exhausted.");
      } else {
        notes.push("SAM exclusions check disabled because no account API key is connected.");
        samConfirmed = true; // operator explicitly runs without SAM checks
      }
    } else if ("error" in excl && excl.error) {
      notes.push(
        "SAM exclusions check errored, status unverified. Outreach held until the next verify run confirms."
      );
      unresolvedFailures.push("SAM exclusions check failed, so exclusion status is unverified.");
    } else {
      samExcluded = excl.excluded;
      samConfirmed = true;
    }
    verification.sam_excluded = samExcluded;
    verification.sam_confirmed = samConfirmed;
    // The date of the actual lookup, so a reused answer never extends itself.
    if (samConfirmed && !("disabled" in excl && excl.disabled)) {
      verification.sam_checked_at = recentSam?.checked_at ?? new Date().toISOString();
    }

    // --- Recorded Google signal; no optional LLM dependency ---
    // Rewording two stored numbers used to make an AI refusal abort the run
    // before any contact/SAM findings were saved, despite worksWithoutClaude.
    // Keep existing prose unchanged and record only the facts available here;
    // individual review contents have not been read or independently verified.
    const reviewsSummary: string | null = sub.reviews_summary ?? null;
    if ((sub.review_count ?? 0) > 0 && sub.google_rating != null) {
      verification.google_signal = { rating: sub.google_rating, review_count: sub.review_count };
      notes.push("Google rating and review count are recorded signals; individual reviews were not read. Existing review summary preserved.");
    }

    // --- BBB: no API ---
    const bbbSummary: string | null = sub.bbb_summary ?? null;
    notes.push("BBB rating unavailable, no BBB API.");

    // --- Persist findings to the subcontractor row ---
    await query(
      `update subcontractors
         set email=$2, email_verified=$3, phone=$4, license_status=$5,
             sam_excluded=$6, reviews_summary=$7, bbb_summary=$8,
             website=coalesce($9, website), contact_status=$10, email_source=$11,
             contact_checked_at=now()
       where id=$1 and org_id=$12`,
      [
        subcontractorId,
        email,
        emailVerified,
        phone,
        licenseStatus,
        samExcluded,
        reviewsSummary,
        bbbSummary,
        website,
        contactStatus,
        emailSource,
        orgId,
      ]
    );

    // --- Flag missing project history for Call Prep ---
    const needsProjectHistory =
      !Array.isArray(sub.project_history) || sub.project_history.length === 0;
    verification.needs_project_history = needsProjectHistory;
    verification.notes = notes;
    verification.email = email;
    verification.email_verified = emailVerified;
    verification.email_source = emailSource;
    verification.contact_status = contactStatus;
    verification.phone = phone;
    verification.website = website;
    verification.unresolved_failures = unresolvedFailures;
    const incomplete = unresolvedFailures.length > 0;

    await query(
      `update opportunity_subs
         set verified=$6, verification_json=coalesce(verification_json,'{}'::jsonb) || $3::jsonb
       where opportunity_id=$1 and subcontractor_id=$2
         and coalesce(trade,'') = coalesce($4,'') and org_id=$5`,
      [
        opportunityId,
        subcontractorId,
        JSON.stringify(verification),
        trade ?? null,
        orgId,
        !incomplete,
      ]
    );

    // --- Standards gate + contact pathway + route ---
    // Automation cannot run without a way to reach the sub. SAM/rating pass
    // alone is not enough — empty-contact shells stay paired for history but
    // do not enter Outreach or the Call Queue.
    const minRating = std?.min_google_rating;
    const ratingOk =
      minRating == null ||
      sub.google_rating == null ||
      sub.google_rating >= minRating;
    const contactOk = hasContactPathway({ email, phone, website });
    const standardsOk = !samExcluded && samConfirmed && ratingOk;
    const passes = standardsOk && contactOk && !incomplete;

    const enqueued: AgentResult["enqueued"] = [];
    let route = "held";
    if (passes && isEmailable({ email, email_verified: emailVerified })) {
      enqueued.push({
        agent: "outreach",
        payload: { opportunityId, subcontractorId, trade },
      });
      route = "outreach queued";
    } else if (passes && phone) {
      // Phone but no verified email: skip dead-end draft emails; queue a call.
      // On an email-only account there is no call to queue, so the pairing is
      // recorded as unreachable and nothing is handed to the operator.
      if (await areCallsEnabled()) {
        enqueued.push({
          agent: "call-prep",
          payload: { opportunityId, subcontractorId, trade, source: "outreach" },
          opts: {
            singletonKey: `callprep:${opportunityId}:${subcontractorId}`,
            singletonSeconds: 3600,
          },
        });
        route = "call queued (phone only, no verified email)";
      } else {
        route = "skipped (phone only, no verified email, calling is off)";
      }
      await query(
        `update opportunity_subs
            set outreach_state = 'no_email'
          where opportunity_id = $1 and subcontractor_id = $2
            and coalesce(trade,'') = coalesce($3,'') and org_id = $4`,
        [opportunityId, subcontractorId, trade ?? null, orgId]
      );
    } else if (standardsOk && !contactOk) {
      route = "held (no email, phone, or website)";
      await query(
        `update opportunity_subs
            set outreach_state = 'no_email'
          where opportunity_id = $1 and subcontractor_id = $2
            and coalesce(trade,'') = coalesce($3,'') and org_id = $4`,
        [opportunityId, subcontractorId, trade ?? null, orgId]
      );
      await query(
        `update opportunities set human_action_required = true where id = $1 and org_id = $2`,
        [opportunityId, orgId]
      );
    } else {
      route = incomplete ? "held (verification incomplete)" : "held (failed standards)";
    }

    // Only waiting on SAM's daily allowance: nothing for a person to do, and
    // retrying before it resets spends the next day's allowance too.
    const waitingOnSamBudget = samBudgetSpent && unresolvedFailures.length === 1;
    if (waitingOnSamBudget) {
      const { secondsUntilNextUtcDay } = await import("../domain/rfq-volume");
      enqueued.push({
        agent: "sub-verify",
        payload: { opportunityId, subcontractorId, trade },
        opts: {
          // Spread the morning's checks over half an hour after the reset.
          startAfterSeconds: secondsUntilNextUtcDay(new Date()) + 300 + Math.floor(Math.random() * 1800),
          singletonKey: `verify-after-sam-reset:${opportunityId}:${subcontractorId}:${trade ?? ""}`,
          singletonSeconds: 86_400,
        },
      });
      route = "waiting for SAM's daily allowance to reset";
    }

    if (incomplete && !waitingOnSamBudget) {
      await query(
        `update opportunities set human_action_required = true where id = $1 and org_id = $2`,
        [opportunityId, orgId]
      );
    }

    // A miss is replaced, not accepted: most small firms publish no usable
    // address, so verifying only the top few left most trades with nobody
    // to email while ranked candidates sat unchecked. Not while SAM's
    // allowance is spent: the next candidate would only wait as well.
    let nextCandidate: string | null = null;
    if (route !== "outreach queued" && !waitingOnSamBudget) {
      nextCandidate = await queueNextCandidate({
        orgId, opportunityId, trade: trade ?? "", verifyTopN: std?.verify_top_n ?? 5,
      }).catch((err) => {
        console.error(`[sub-verify] could not queue the next candidate: ${(err as Error).message}`);
        return null;
      });
    }

    const summary = `Verified ${sub.company_name}: email ${
      emailVerified ? `verified (${emailSource ?? "existing"})` : email ? "unverified" : website ? "not found" : "not found (no website)"
    }, phone ${phone ? "on file" : "missing"}, SAM ${samExcluded ? "EXCLUDED" : samConfirmed ? "clear" : "UNVERIFIED"}, license ${licenseStatus} → ${route}.`;

    return {
      ok: !incomplete || waitingOnSamBudget,
      summary: incomplete
        ? `${summary} Verification is incomplete: ${unresolvedFailures.join(" ")}`
        : summary,
      reasoning: `Standards gate: sam_excluded=${samExcluded}, rating_ok=${ratingOk}, contact_ok=${contactOk}. Notes: ${
        notes.join(" ") || "none"
      }`,
      data: {
        email,
        emailVerified,
        emailSource,
        contactStatus,
        website,
        phone,
        samExcluded,
        licenseStatus,
        needsProjectHistory,
        passes,
        contactOk,
        route,
        unresolvedFailures,
        nextCandidate,
      },
      enqueued,
      humanActionRequired: (incomplete && !waitingOnSamBudget) || (standardsOk && !contactOk),
    };
  },
};

/** Matches on the address and its verification, as outreach does. */
const EMAILABLE_PAIR_SQL = `(e.verification_json->>'email_verified')::boolean is true
  and coalesce(e.verification_json->>'email', '') <> ''`;

/**
 * Queue verification for the next-ranked unchecked candidate in this trade.
 *
 * The k-th miss in a trade checks the candidate ranked verify_top_n + k, so
 * every miss is replaced once and concurrent misses ask for different
 * candidates. Stops when the trade already has as many emailable firms as it
 * may be sent, or when the ranked list runs out. Queued directly so a
 * duplicate is simply ignored rather than reported as a refused step.
 */
export async function queueNextCandidate(input: {
  orgId: string;
  opportunityId: string;
  trade: string;
  verifyTopN: number;
}): Promise<string | null> {
  const { getAutomationRules } = await import("../app-settings");
  const { normalizeRules } = await import("../domain/intake");
  const perTradeCap = normalizeRules(await getAutomationRules()).rfq_subs_per_trade;
  const row = await queryOne<{ emailable: number; misses: number }>(
    `select count(*) filter (where ${EMAILABLE_PAIR_SQL})::int as emailable,
            count(*) filter (where e.verification_json is not null and not (${EMAILABLE_PAIR_SQL}))::int as misses
       from opportunity_subs e
      where e.opportunity_id = $1 and coalesce(e.trade,'') = $2 and e.org_id = $3 and e.removed_at is null`,
    [input.opportunityId, input.trade, input.orgId]
  );
  if (!row || row.emailable >= perTradeCap || row.misses < 1) return null;
  const next = await queryOne<{ subcontractor_id: string }>(
    `select subcontractor_id from opportunity_subs e
      where e.opportunity_id = $1 and coalesce(e.trade,'') = $2 and e.org_id = $3 and e.removed_at is null
      order by e.candidate_rank asc nulls last, e.created_at asc
      offset $4 limit 1`,
    [input.opportunityId, input.trade, input.orgId, Math.max(1, input.verifyTopN) + row.misses - 1]
  );
  if (!next) return null;
  const { enqueue } = await import("../queue");
  const queued = await enqueue(
    "sub-verify",
    { opportunityId: input.opportunityId, subcontractorId: next.subcontractor_id, trade: input.trade },
    { singletonKey: `verify:${input.opportunityId}:${next.subcontractor_id}:${input.trade}`, singletonSeconds: 3600, orgId: input.orgId }
  );
  return queued ? next.subcontractor_id : null;
}
