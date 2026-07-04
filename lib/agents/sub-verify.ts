/**
 * SUB VERIFY — triggered per candidate by Sub Finder.
 * Enriches and vets a single subcontractor: finds + verifies a contact email
 * (Hunter), fills in a missing phone (Google Place Details), records license
 * status (no state-license API exists yet — kept 'unknown' with a note that the
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
import { sam } from "../integrations/sam";
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

    // --- Email discovery + verification ---
    let email: string | null = sub.email ?? null;
    let emailVerified = sub.email_verified ?? false;
    const domain = domainOf((sub as { website?: string | null }).website ?? null);

    if (domain) {
      const ds = await hunter.domainSearch(domain);
      if (ds.disabled) {
        notes.push("Hunter disabled — email not discovered.");
      } else {
        const best = pickBestEmail(ds.emails);
        if (best) {
          email = best.value;
          const v = await hunter.verifyEmail(best.value);
          emailVerified = v.status === "valid";
          verification.email_confidence = best.confidence;
          verification.email_status = v.status ?? null;
        }
      }
    } else {
      // No website domain — try to guess from the company name.
      const fe = await hunter.findEmail({ company: sub.company_name, domain: "" });
      if (fe.disabled) {
        notes.push("Hunter disabled — email not discovered.");
      } else if (fe.email) {
        email = fe.email;
        const v = await hunter.verifyEmail(fe.email);
        emailVerified = v.status === "valid";
        verification.email_status = v.status ?? null;
      } else {
        notes.push("No website domain and no email guess available.");
      }
    }

    // --- Phone via Google Place Details (only if missing) ---
    let phone: string | null = sub.phone ?? null;
    const placeId = (sub as { google_place_id?: string | null }).google_place_id ?? null;
    if (!phone && placeId) {
      const details = await googleMaps.placeDetails(placeId);
      if (details?.phone) phone = details.phone;
    }

    // --- License status: no state-license API yet ---
    const licenseStatus = sub.license_status ?? "unknown";
    if (licenseStatus === "unknown") {
      notes.push("License status unverified — needs the state license-board scraper.");
    }
    verification.license_status = licenseStatus;

    // --- SAM exclusions ---
    let samExcluded = sub.sam_excluded ?? false;
    const excl = await sam.isExcluded(sub.company_name);
    if (excl.disabled) {
      notes.push("SAM exclusions check disabled.");
    } else {
      samExcluded = excl.excluded;
    }
    verification.sam_excluded = samExcluded;

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
        notes.push("Claude not configured — reviews summary skipped.");
      }
    }

    // --- BBB: no API ---
    const bbbSummary: string | null = sub.bbb_summary ?? null;
    notes.push("BBB rating unavailable — no BBB API.");

    // --- Persist findings to the subcontractor row ---
    await query(
      `update subcontractors
         set email=$2, email_verified=$3, phone=$4, license_status=$5,
             sam_excluded=$6, reviews_summary=$7, bbb_summary=$8
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
      ]
    );

    // --- Flag missing project history for Call Prep ---
    const needsProjectHistory =
      !Array.isArray(sub.project_history) || sub.project_history.length === 0;
    verification.needs_project_history = needsProjectHistory;
    verification.notes = notes;
    verification.email = email;
    verification.email_verified = emailVerified;
    verification.phone = phone;

    await query(
      `update opportunity_subs
         set verified=true, verification_json=$3
       where opportunity_id=$1 and subcontractor_id=$2
         and coalesce(trade,'') = coalesce($4,'')`,
      [opportunityId, subcontractorId, JSON.stringify(verification), trade ?? null]
    );

    // --- Standards gate + route to Outreach ---
    const minRating = std?.min_google_rating;
    const ratingOk =
      minRating == null ||
      sub.google_rating == null ||
      sub.google_rating >= minRating;
    const passes = !samExcluded && ratingOk;

    const enqueued: AgentResult["enqueued"] = [];
    if (passes) {
      enqueued.push({
        agent: "outreach",
        payload: { opportunityId, subcontractorId, trade },
      });
    }

    const summary = `Verified ${sub.company_name}: email ${
      emailVerified ? "verified" : email ? "unverified" : "not found"
    }, SAM ${samExcluded ? "EXCLUDED" : "clear"}, license ${licenseStatus}${
      passes ? " → outreach queued" : " → held (failed standards)"
    }.`;

    return {
      ok: true,
      summary,
      reasoning: `Standards gate: sam_excluded=${samExcluded}, rating_ok=${ratingOk}. Notes: ${
        notes.join(" ") || "none"
      }`,
      data: { email, emailVerified, phone, samExcluded, licenseStatus, needsProjectHistory, passes },
      enqueued,
    };
  },
};
