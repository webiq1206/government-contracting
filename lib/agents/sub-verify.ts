/**
 * SUB VERIFY, triggered per candidate by Sub Finder.
 * Enriches and vets a single subcontractor: finds + verifies a contact email
 * (Hunter), fills in a missing phone (Google Place Details), records license
 * status (no state-license API exists yet, kept 'unknown' with a note that the
 * state scraper still owes this), checks SAM exclusions, and summarizes Google
 * reviews with Claude. Findings are written back to the subcontractors row and
 * the opportunity_subs verification record. Subs that clear our standards are
 * handed to Outreach.
 */
import { query, queryOne } from "../db";
import { complete, ClaudeNotConfiguredError } from "../ai/claude";
import { getProfileJson } from "../ai/companyProfile";
import { logAgent } from "../logger";
import { googleMaps } from "../integrations/googleMaps";
import { hunter } from "../integrations/hunter";
import { scrapeWebsiteEmail, domainHasMx } from "../integrations/email-scrape";
import { findWebsiteBysearch } from "../integrations/website-finder";
import { sam } from "../integrations/sam";
import { hasContactPathway, isEmailable } from "../domain/sub-contactability";
import { areCallsEnabled } from "../app-settings";
import { currentOrgId } from "../tenant-context";
import type { AgentDefinition } from "./types";
import type { AgentResult, Subcontractor } from "../types";

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
    "Enriches + vets a candidate sub: verifies email, fills phone, checks SAM exclusions, summarizes reviews, then routes qualifying subs to Outreach.",
  worksWithoutClaude: true, // review summary is optional; enrichment is rule-based
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

    const owner = await queryOne<{ org_id: string | null; location_state: string | null }>(
      `select org_id, location_state from opportunities where id=$1 and org_id=$2`,
      [opportunityId, orgId]
    );
    const sub = await queryOne<Subcontractor & { website?: string | null; google_place_id?: string | null }>(
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

    const profile = await getProfileJson();
    const std = profile?.sub_standards;

    const notes: string[] = [];
    const verification: Record<string, unknown> = {};
    const unresolvedFailures: string[] = [];

    // --- Geography gate, before any enrichment spends an API call ---
    // A firm recorded in a different state than the work cannot mobilize for
    // it, and emailing them anyway burns the org's credibility and the quote
    // window. Pairings created before Sub Finder verified addresses can still
    // carry wrong-area firms; this is where they stop. Unknown sub state
    // passes through: absence of data is not evidence of distance.
    const workState = (owner.location_state ?? "").trim().toUpperCase();
    const subState = (sub.state ?? "").trim().toUpperCase();
    if (workState && subState && workState !== subState) {
      await query(
        `update opportunity_subs
            set verified = false,
                outreach_state = 'not_a_fit',
                verification_json = coalesce(verification_json, '{}'::jsonb)
                  || jsonb_build_object('geography', $3::text)
          where opportunity_id = $1 and subcontractor_id = $2 and org_id = $4`,
        [
          opportunityId,
          subcontractorId,
          `Firm is in ${subState}; the work is in ${workState}.`,
          orgId,
        ]
      );
      await logAgent({
        agent: "sub-verify",
        action: "geography-mismatch",
        level: "warn",
        opportunityId,
        subcontractorId,
        message: `${sub.company_name} is in ${subState} but this work is in ${workState}, so they were ruled out for this solicitation. They stay on the roster for work in their own area.`,
      });
      return {
        ok: true,
        summary: `${sub.company_name} ruled out: located in ${subState}, work is in ${workState}.`,
      };
    }

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
      let scraped: Awaited<ReturnType<typeof scrapeWebsiteEmail>> = null;
      try {
        scraped = await scrapeWebsiteEmail(website);
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
        emailSource = "website_scrape";
        // Prefer Hunter's SMTP-level verify when configured. Without Hunter,
        // policy (operator-approved): an address published on the sub's OWN
        // website whose domain accepts mail (MX) is treated as sendable —
        // the sub itself asks to be contacted there. Free-mail / off-domain
        // or MX-missing finds stay unverified drafts for operator approval.
        const v = await hunter.verifyEmail(scraped.email);
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
      } else if (!unresolvedFailures.some((failure) => failure.startsWith("Website email crawl failed"))) {
        const message =
          "The website crawl returned no usable email. This is inconclusive because inaccessible pages and pages with no published email currently produce the same result.";
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
    const excl = await sam.isExcluded(sub.company_name, orgId);
    if (excl.disabled) {
      if (excl.disabledReason === "quota_exhausted") {
        notes.push(
          "SAM exclusions check could not run because today's account call budget is exhausted. Outreach is held until a later verification confirms the result."
        );
        unresolvedFailures.push("SAM exclusions check could not run because the account call budget is exhausted.");
      } else {
        notes.push("SAM exclusions check disabled because no account API key is connected.");
        samConfirmed = true; // operator explicitly runs without SAM checks
      }
    } else if (excl.error) {
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

    // --- Reviews summary via Claude (best effort) ---
    let reviewsSummary: string | null = sub.reviews_summary ?? null;
    if ((sub.review_count ?? 0) > 0 && sub.google_rating != null) {
      try {
        const { text } = await complete(
          `Summarize the reputation of the subcontractor "${sub.company_name}" in 1-2 sentences for a bid team, based only on this Google signal: ${sub.google_rating} stars across ${sub.review_count} reviews. Be factual and concise; do not invent specifics.`,
          { maxTokens: 120, injectProfile: false }
        );
        reviewsSummary = text.trim();
      } catch (err) {
        if (!(err instanceof ClaudeNotConfiguredError)) throw err;
        notes.push("Claude not configured, reviews summary skipped.");
      }
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
         set verified=$6, verification_json=$3
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

    if (incomplete) {
      await query(
        `update opportunities set human_action_required = true where id = $1 and org_id = $2`,
        [opportunityId, orgId]
      );
    }

    const summary = `Verified ${sub.company_name}: email ${
      emailVerified ? `verified (${emailSource ?? "existing"})` : email ? "unverified" : website ? "not found" : "not found (no website)"
    }, phone ${phone ? "on file" : "missing"}, SAM ${samExcluded ? "EXCLUDED" : samConfirmed ? "clear" : "UNVERIFIED"}, license ${licenseStatus} → ${route}.`;

    return {
      ok: !incomplete,
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
      },
      enqueued,
      humanActionRequired: incomplete || (standardsOk && !contactOk),
    };
  },
};
