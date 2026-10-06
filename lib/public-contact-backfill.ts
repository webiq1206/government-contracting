import { query, queryOne } from "./db";
import { getWorkExecution } from "./app-settings";
import { tradeSelfPerformedSql } from "./domain/work-mode";
import { suppressionBlocking } from "./suppressions";
import { scrapeWebsiteEmail } from "./integrations/email-scrape";
import { findWebsiteBysearch } from "./integrations/website-finder";
import type { AgentResult, Subcontractor } from "./types";

/** Apply eligibility before the limit, so skipped firms cannot monopolize a batch. */
export async function publicContactCandidates(orgId: string, workMode: string) {
  return query<{ subcontractor_id: string; opportunity_id: string; trade: string }>(
    `select distinct on (s.id) os.subcontractor_id, os.opportunity_id, os.trade
      from subcontractors s
      join opportunity_subs os on os.subcontractor_id=s.id and os.org_id=s.org_id and os.removed_at is null
      join opportunities o on o.id=os.opportunity_id and o.org_id=s.org_id
      where s.org_id=$1 and s.blacklisted=false and s.archived_at is null
        and o.status='open' and o.is_sources_sought is not true
        and coalesce(o.pursuit_state,'active')='active' and coalesce(o.work_mode,$2)<>'self'
        and not ${tradeSelfPerformedSql("o", "os.trade", "$2")}
        and (nullif(btrim(o.location_state),'') is null or nullif(btrim(s.state),'') is null
          or upper(btrim(o.location_state))=upper(btrim(s.state)))
        and nullif(btrim(s.email),'') is null
        and (s.contact_checked_at is null or s.contact_checked_at < now()-interval '7 days')
        and not exists (select 1 from outreach_suppressions stop where stop.org_id=$1
          and stop.subcontractor_id=s.id and stop.lifted_at is null and stop.channel in ('all','email')
          and (stop.opportunity_id is null or stop.opportunity_id=os.opportunity_id)
          and (stop.trade is null or lower(btrim(stop.trade))=lower(btrim(os.trade))))
      order by s.id, s.contact_checked_at asc nulls first limit 20`, [orgId, workMode]);
}

/** Public-only maintenance: no paid provider, verification promotion or outreach. */
export async function backfillPublicContact(orgId: string, opportunityId: string, sub: Subcontractor & { website?: string | null }, trade: string | undefined): Promise<AgentResult> {
  if (sub.email?.trim() || sub.blacklisted) return { ok: true, summary: "Contact research skipped: an email is already saved or the firm is blocked." };
  const blocked = await suppressionBlocking({ subcontractorId: sub.id, opportunityId, trade: trade ?? null, channel: "email" }, orgId);
  if (blocked) return { ok: true, summary: "Contact research skipped because this relationship is suppressed." };
  const workMode = await getWorkExecution();
  // Claim before external reads. Failed lookups also back off for seven days.
  // Recheck current ownership and pursuit state, including jobs queued earlier.
  const claimed = await queryOne<{ id: string }>(
    `update subcontractors s set contact_checked_at=now()
      where s.id=$1 and s.org_id=$2 and s.blacklisted=false and s.archived_at is null
        and nullif(btrim(s.email),'') is null
        and (s.contact_checked_at is null or s.contact_checked_at < now()-interval '7 days')
        and exists (select 1 from opportunity_subs os join opportunities o on o.id=os.opportunity_id and o.org_id=os.org_id
          where os.subcontractor_id=s.id and os.org_id=$2 and os.opportunity_id=$3
            and os.removed_at is null and ($4::text is null or os.trade=$4)
            and o.status='open' and coalesce(o.pursuit_state,'active')='active'
            and o.is_sources_sought is not true and coalesce(o.work_mode,$5)<>'self'
            and not ${tradeSelfPerformedSql("o", "os.trade", "$5")}
            and (nullif(btrim(o.location_state),'') is null or nullif(btrim(s.state),'') is null
              or upper(btrim(o.location_state))=upper(btrim(s.state))))
      returning s.id`, [sub.id, orgId, opportunityId, trade ?? null, workMode]);
  if (!claimed) return { ok: true, summary: "Contact research skipped: this record is no longer eligible or was checked recently." };
  const website = sub.website || await findWebsiteBysearch({ companyName: sub.company_name, city: sub.city ?? null, state: sub.state ?? null });
  const candidate = website ? await scrapeWebsiteEmail(website) : null;
  if (!candidate) return { ok: true, summary: "No public email was found in the pages checked. This does not prove the business has no email. Research can run again after seven days." };
  // Save evidence on this pairing only; do not overwrite a concurrently saved
  // address or turn discovery into permission to contact the business.
  const saved = await queryOne<{ id: string }>(
    `with saved as (update subcontractors s set email=$3, email_verified=false, email_source=$4,
        website=coalesce(nullif(website,''),$5), updated_at=now()
      where id=$1 and org_id=$2 and blacklisted=false and archived_at is null and nullif(btrim(email),'') is null
        and exists (select 1 from opportunity_subs os join opportunities o on o.id=os.opportunity_id and o.org_id=os.org_id
          where os.org_id=$2 and os.opportunity_id=$6 and os.subcontractor_id=$1
            and os.removed_at is null and ($7::text is null or os.trade=$7)
            and o.status='open' and coalesce(o.pursuit_state,'active')='active' and o.is_sources_sought is not true
            and coalesce(o.work_mode,$9)<>'self'
            and not ${tradeSelfPerformedSql("o", "os.trade", "$9")}
            and (nullif(btrim(o.location_state),'') is null or nullif(btrim(s.state),'') is null
              or upper(btrim(o.location_state))=upper(btrim(s.state))))
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
      opportunityId, trade ?? null, JSON.stringify({ email: candidate.email, source_url: candidate.sourceUrl, source_type: candidate.sourceType, checked_at: candidate.checkedAt, verified: false }), await getWorkExecution()]);
  if (!saved) return { ok: true, summary: "Contact research finished, but the record changed. The existing contact was preserved." };
  return { ok: true, summary: "A public email was saved with its source. It still needs verification. No message was queued or sent." };
}
