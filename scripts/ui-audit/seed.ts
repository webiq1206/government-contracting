import { writeFileSync } from "node:fs";
import { queryOne, query, closePool } from "../../lib/db";
import { hashPassword } from "../../lib/auth";
import { encodePortalToken } from "../../lib/domain/sub-portal-link";
import { buildNoticeBrief } from "../../lib/domain/notice-brief";

async function main() {
if (process.env.CI !== "true" || process.env.PGHOST !== "127.0.0.1" || process.env.PGDATABASE !== "brostco_audit" || process.env.USE_REPLIT_DEV_DB !== "true") {
  throw new Error("UI fixtures require the disposable local CI database.");
}
try {
  const org = await queryOne<{id:string}>("insert into organizations(name,subscription_status,plan_key,billing_exempt) values('Interface Audit Workspace','active','standard',true) returning id");
  const research = await queryOne<{id:string}>(`insert into opportunities(org_id,source,source_id,title,agency,stage,status,score,tier,is_sources_sought,human_action_required,risk_flags) values($1,'manual','ui-research','Historical Sources Sought audit','Audit Agency','sourcing','open',80,'pursue',true,true,array['outside_service_area']) returning id`, [org!.id]);
  await query("update opportunities set solicitation_analysis=$2 where id=$1", [research!.id, JSON.stringify({ ...buildNoticeBrief({ title: "Historical Sources Sought audit", agency: "Audit Agency", description: "Historical electrical scope retained for reference." }), submission_requirements: ["Provide a capability statement for agency market research."] })]);
  const researchRequirementId = "sub:provide-a-capability-statement-for-agency-market-research";
  await query("insert into requirement_states(org_id,opportunity_id,requirement_id,state) values($1,$2,$3,'in_progress')", [org!.id,research!.id,researchRequirementId]);
  await query("insert into requirement_state_events(org_id,opportunity_id,requirement_id,from_state,to_state,actor_kind,actor_label,note) values($1,$2,$3,'not_started','in_progress','person','Synthetic owner','Saved historical requirement note')", [org!.id,research!.id,researchRequirementId]);
  for (const role of ["owner","tenant-owner","admin","operator","member","viewer"]) {
    const user = await queryOne<{id:string}>("insert into users(email,password_hash,role,name) values($1,$2,$3,$4) returning id", [`ui-${role}@example.test`,hashPassword("DisposableUiAudit123!"),role === "owner" ? "admin" : role === "viewer" ? "viewer" : "operator",`Audit ${role}`]);
    await query("insert into organization_members(org_id,user_id,role) values($1,$2,$3)",[org!.id,user!.id,role === "tenant-owner" ? "owner" : role]);
  }
  const opp=await queryOne<{id:string}>(`insert into opportunities(org_id,source,source_id,title,agency,stage,status,score,tier,deadline,human_action_required) values($1,'manual','ui-audit','Facility maintenance and electrical upgrades','Audit Agency','scoring','open',62,'review',now()+interval '10 days',true) returning id`,[org!.id]);
  const sub=await queryOne<{id:string}>(`insert into subcontractors(org_id,company_name,trade_categories,state,city) values($1,'Sample Electrical Services',array['Electrical'],'ID','Boise') returning id`,[org!.id]);
  const contract=await queryOne<{id:string}>(`insert into contracts(org_id,opportunity_id,contract_number,award_amount,status) values($1,$2,'AUDIT-001',25000,'active') returning id`,[org!.id,opp!.id]);
  await query("update subcontractors set phone = '2085550100' where id = $1", [sub!.id]);
  await query("insert into opportunity_subs(opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,'Electrical','responsive')", [research!.id,sub!.id]);
  await query(`insert into communications(org_id,subcontractor_id,opportunity_id,channel,direction,subject,body,recipient_email,delivery_state) values($1,$2,$3,'email','outbound','Research response draft','Saved research draft only.','fixture@example.test','draft')`, [org!.id,sub!.id,research!.id]);
  await query("insert into opportunity_subs(opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,'Electrical','draft')", [opp!.id,sub!.id]);
  const call=await queryOne<{id:string}>(`insert into call_cards(org_id,opportunity_id,subcontractor_id,card_json,status) values($1,$2,$3,'{}','pending') returning id`,[org!.id,opp!.id,sub!.id]);
  await query(`insert into organizations(name,slug,subscription_status,classification)
    select 'Pagination Audit '||lpad(n::text,3,'0'),'pagination-audit-'||n,'active','test' from generate_series(1,57) n`);
  await query(`insert into communications(org_id,channel,direction,subject,body,recipient_email,delivery_state)
    values($1,'email','outbound','Ledger Audit Draft','Synthetic wording for the ledger regression.','fixture@example.test','draft')`, [org!.id]);
  await query(`insert into communications(org_id,subcontractor_id,opportunity_id,channel,direction,subject,body,recipient_email,delivery_state,gmail_thread_id,created_at)
    values ($1,$2,$3,'email','outbound','Email clarity audit','Please quote the electrical work.','fixture@example.test','sent','clarity-audit-thread',now()-interval '2 hours'),
           ($1,$2,$3,'email','inbound','Re: Email clarity audit','Friday works.\n\nOn Tuesday Alex wrote:\n> Please quote the electrical work.','owner@example.test','sent','clarity-audit-thread',now()-interval '1 hour')`, [org!.id,sub!.id,opp!.id]);
  writeFileSync("/tmp/ui-fixtures.json",JSON.stringify({org:org!.id,opportunity:opp!.id,research:research!.id,sub:sub!.id,contract:contract!.id,call:call!.id,vendorToken:encodePortalToken({s:sub!.id,e:Math.floor(Date.now()/1000)+3600})}));
} finally { await closePool(); }

}
main().catch(error => { console.error(error); process.exitCode=1; });
