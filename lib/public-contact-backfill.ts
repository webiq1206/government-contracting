import { queryOne } from "./db";
import { suppressionBlocking } from "./suppressions";
import { scrapeWebsiteEmail } from "./integrations/email-scrape";
import { findWebsiteBysearch } from "./integrations/website-finder";
import type { AgentResult, Subcontractor } from "./types";

/** Public-only maintenance: no paid provider, verification promotion or outreach. */
export async function backfillPublicContact(orgId: string, opportunityId: string, sub: Subcontractor & { website?: string | null }, trade: string | undefined): Promise<AgentResult> {
  if (sub.email?.trim() || sub.blacklisted) return { ok: true, summary: "Contact research skipped: an email is already saved or the firm is blocked." };
  const blocked = await suppressionBlocking({ subcontractorId: sub.id, opportunityId, trade: trade ?? null, channel: "email" }, orgId);
  if (blocked) return { ok: true, summary: "Contact research skipped because this relationship is suppressed." };
  // Claim before external reads. Failed lookups also back off for seven days.
  // Recheck current ownership and pursuit state, including jobs queued earlier.
  const claimed = await queryOne<{ id: string }>(
    `update subcontractors s set contact_checked_at=now()
      where s.id=$1 and s.org_id=$2 and s.blacklisted=false
        and nullif(btrim(s.email),'') is null
        and (s.contact_checked_at is null or s.contact_checked_at < now()-interval '7 days')
        and exists (select 1 from opportunity_subs os join opportunities o on o.id=os.opportunity_id and o.org_id=os.org_id
          where os.subcontractor_id=s.id and os.org_id=$2 and os.opportunity_id=$3
            and os.removed_at is null and ($4::text is null or os.trade=$4)
            and o.status='open' and coalesce(o.pursuit_state,'active')='active'
            and o.is_sources_sought is not true)
      returning s.id`, [sub.id, orgId, opportunityId, trade ?? null]);
  if (!claimed) return { ok: true, summary: "Contact research skipped: this record is no longer eligible or was checked recently." };
  const website = sub.website || await findWebsiteBysearch({ companyName: sub.company_name, city: sub.city ?? null, state: sub.state ?? null });
  const candidate = website ? await scrapeWebsiteEmail(website) : null;
  if (!candidate) return { ok: true, summary: "No public email was found in the pages checked. This does not prove the business has no email. Research can run again after seven days." };
  // Save evidence on this pairing only; do not overwrite a concurrently saved
  // address or turn discovery into permission to contact the business.
  const saved = await queryOne<{ id: string }>(
    `with saved as (update subcontractors set email=$3, email_verified=false, email_source=$4,
        website=coalesce(nullif(website,''),$5), updated_at=now()
      where id=$1 and org_id=$2 and blacklisted=false and nullif(btrim(email),'') is null
        and exists (select 1 from opportunity_subs os join opportunities o on o.id=os.opportunity_id and o.org_id=os.org_id
          where os.org_id=$2 and os.opportunity_id=$6 and os.subcontractor_id=$1
            and os.removed_at is null and ($7::text is null or os.trade=$7)
            and o.status='open' and coalesce(o.pursuit_state,'active')='active' and o.is_sources_sought is not true)
        and not exists (select 1 from outreach_suppressions stop
          where stop.org_id=$2 and stop.subcontractor_id=$1 and stop.lifted_at is null
            and stop.channel in ('all','email') and (stop.opportunity_id is null or stop.opportunity_id=$6)
            and (stop.trade is null or ($7::text is not null and lower(btrim(stop.trade))=lower(btrim($7))))) returning id),
      evidence as (update opportunity_subs set verification_json=coalesce(verification_json,'{}'::jsonb)
        || jsonb_build_object('email_discovery',$8::jsonb)
        where org_id=$2 and opportunity_id=$6 and subcontractor_id in (select id from saved)
          and ($7::text is null or trade=$7) returning id)
      select id from saved`,
    [sub.id, orgId, candidate.email, candidate.sourceType === "linked_social" ? "linked_public_profile" : "website_scrape", website,
      opportunityId, trade ?? null, JSON.stringify({ email: candidate.email, source_url: candidate.sourceUrl, source_type: candidate.sourceType, checked_at: candidate.checkedAt, verified: false })]);
  if (!saved) return { ok: true, summary: "Contact research finished, but the record changed. The existing contact was preserved." };
  return { ok: true, summary: "A public email was saved with its source. It still needs verification. No message was queued or sent." };
}
