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

    const sub = await queryOne<Subcontractor & { website?: string | null; google_place_id?: string | null }>(
      `select * from subcontractors where id = $1`,
      [subcontractorId]
    );
    if (!sub) return { ok: false, summary: `subcontractor ${subcontractorId} not found` };

    const profile = await getProfileJson();
    const std = profile?.sub_standards;

    const notes: string[] = [];
    const verification: Record<string, unknown> = {};

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
      } else if (!website) {
        notes.push("Google Maps disabled or Place Details empty; no website on file.");
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
        notes.push("Web-search website lookup found no confident match.");
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
        } else {
          const best = pickBestEmail(ds.emails);
          if (best) {
            email = best.value;
            emailSource = "hunter";
            const v = await hunter.verifyEmail(best.value);
            emailVerified = v.status === "valid";
            verification.email_confidence = best.confidence;
            verification.email_status = v.status ?? null;
          }
        }
      } else {
        // No website domain, try to guess from the company name.
        const fe = await hunter.findEmail({ company: sub.company_name, domain: "" });
        if (fe.disabled) {
          notes.push("Hunter disabled, skipping Hunter email discovery.");
        } else if (fe.email) {
          email = fe.email;
          emailSource = "hunter";
          const v = await hunter.verifyEmail(fe.email);
          emailVerified = v.status === "valid";
          verification.email_status = v.status ?? null;
        }
      }
    }

    // Key-free fallback: the sub's own site usually publishes a contact email.
    if (!email && website) {
      const scraped = await scrapeWebsiteEmail(website).catch(() => null);
      if (scraped) {
        email = scraped.email;
        emailSource = "website_scrape";
        // Prefer Hunter's SMTP-level verify when configured. Without Hunter,
        // policy (operator-approved): an address published on the sub's OWN
        // website whose domain accepts mail (MX) is treated as sendable —
        // the sub itself asks to be contacted there. Free-mail / off-domain
        // or MX-missing finds stay unverified drafts for operator approval.
        const v = await hunter.verifyEmail(scraped.email);
        if (!v.disabled) {
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
      }
    }

    // Explicit contactability outcome — "no email" must never be silent.
    const contactStatus = email
      ? emailVerified
        ? "verified"
        : "unverified"
      : website
        ? "no_email_found"
        : "no_website";
    if (!email) {
      notes.push(
        website
          ? "No contact email found via Hunter or website scrape."
          : "No website on file, email discovery impossible."
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
    const excl = await sam.isExcluded(sub.company_name);
    if (excl.disabled) {
      notes.push("SAM exclusions check disabled.");
      samConfirmed = true; // operator explicitly runs without SAM checks
    } else if (excl.error) {
      notes.push(
        "SAM exclusions check errored, status unverified. Outreach held until the next verify run confirms."
      );
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
       where id=$1`,
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

    await query(
      `update opportunity_subs
         set verified=true, verification_json=$3
       where opportunity_id=$1 and subcontractor_id=$2
         and coalesce(trade,'') = coalesce($4,'')`,
      [opportunityId, subcontractorId, JSON.stringify(verification), trade ?? null]
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
    const passes = standardsOk && contactOk;

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
      enqueued.push({
        agent: "call-prep",
        payload: { opportunityId, subcontractorId, trade, source: "outreach" },
        opts: {
          singletonKey: `callprep:${opportunityId}:${subcontractorId}`,
          singletonSeconds: 3600,
        },
      });
      route = "call queued (phone only, no verified email)";
      await query(
        `update opportunity_subs
            set outreach_state = 'no_email'
          where opportunity_id = $1 and subcontractor_id = $2
            and coalesce(trade,'') = coalesce($3,'')`,
        [opportunityId, subcontractorId, trade ?? null]
      );
    } else if (standardsOk && !contactOk) {
      route = "held (no email, phone, or website)";
      await query(
        `update opportunity_subs
            set outreach_state = 'no_email'
          where opportunity_id = $1 and subcontractor_id = $2
            and coalesce(trade,'') = coalesce($3,'')`,
        [opportunityId, subcontractorId, trade ?? null]
      );
      await query(
        `update opportunities set human_action_required = true where id = $1`,
        [opportunityId]
      );
    } else {
      route = "held (failed standards)";
    }

    const summary = `Verified ${sub.company_name}: email ${
      emailVerified ? `verified (${emailSource ?? "existing"})` : email ? "unverified" : website ? "not found" : "not found (no website)"
    }, phone ${phone ? "on file" : "missing"}, SAM ${samExcluded ? "EXCLUDED" : samConfirmed ? "clear" : "UNVERIFIED"}, license ${licenseStatus} → ${route}.`;

    return {
      ok: true,
      summary,
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
      },
      enqueued,
      humanActionRequired: standardsOk && !contactOk,
    };
  },
};
