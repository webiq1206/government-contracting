import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { defaultCompanyProfile } from "../../lib/domain/default-profile";
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
  const archived=await queryOne<{id:string}>(`insert into opportunities(org_id,source,source_id,title,agency,stage,status,deadline)
    values($1,'manual','ui-archived-docs','Archived document coverage audit','Audit Agency','call_queue','archived',now()-interval '2 days') returning id`,[org!.id]);
  // Saved states only, with no real files, generation, or background worker.
  await query(`insert into documents(org_id,opportunity_id,kind,name,document_class,disposition,extraction_state,page_count,storage_backend)
    select $1,$2,'solicitation','Audit_Read_'||n||'.pdf','solicitation','delivered','extracted',1,'local'
    from generate_series(1,11) n`,[org!.id,archived!.id]);
  await query(`insert into documents(org_id,opportunity_id,kind,name,document_class,disposition,extraction_state,page_count,storage_backend)
    values($1,$2,'solicitation','Audit_Partial.pdf','solicitation','delivered','partial',2,'local'),
      ($1,$2,'solicitation','Audit_Empty_Pricing_Schedule.docx','pricing_schedule','delivered','not_applicable',null,'local')`,[org!.id,archived!.id]);
  const sourceAudit=await queryOne<{id:string}>(`insert into opportunities(org_id,source,source_id,title,agency,stage,status,is_sources_sought)
    values($1,'manual','ui-source-alignment','Synthetic requirement source audit','Audit Agency','scoring','open',true) returning id`,[org!.id]);
  const sourceDocs: {id:string}[] = [];
  const pdf = await PDFDocument.create();
  for (let page=1;page<=50;page++) pdf.addPage().drawText(`Synthetic audit source, page ${page}`);
  const pdfBytes=await pdf.save();
  mkdirSync(join(process.cwd(),'.data','storage',org!.id),{recursive:true});
  for (const label of ['First','Second']) {
    const key=`${org!.id}/audit-${label.toLowerCase()}-source.pdf`;
    writeFileSync(join(process.cwd(),'.data','storage',key),pdfBytes);
    const doc=await queryOne<{id:string}>(`insert into documents(org_id,opportunity_id,kind,name,document_class,disposition,extraction_state,page_count,storage_backend,storage_path,mime)
      values($1,$2,'solicitation',$3,'solicitation','delivered','extracted',50,'local',$4,'application/pdf') returning id`,[org!.id,sourceAudit!.id,`${label} synthetic source.pdf`,key]);
    sourceDocs.push(doc!);
  }
  await query("update opportunities set solicitation_analysis=$2 where id=$1",[sourceAudit!.id,JSON.stringify({
    ...buildNoticeBrief({title:'Synthetic requirement source audit'}),
    compliance_matrix:[44,12].map(page=>({id:`audit-page-${page}`,title:`Synthetic requirement page ${page}`,category:'form',mandatory:true,
      source_document_id:sourceDocs[1].id,source_document:'Second synthetic source.pdf',source_page:page,satisfied_by:'operator_signature'})).concat([{
      id:'audit-missing-source',title:'Synthetic requirement without a stored source',category:'form',mandatory:true,
      source_document_id:'00000000-0000-4000-8000-000000000000',source_document:'Unavailable synthetic source.pdf',source_page:9,satisfied_by:'operator_signature'
    }])
  })]);
  await query("insert into requirement_states(org_id,opportunity_id,requirement_id,state,blocking_reason) values($1,$2,'audit-page-12','needs_clarification','Synthetic source question for filter coverage.')",[org!.id,sourceAudit!.id]);
  const setupOrg=await queryOne<{id:string}>("insert into organizations(name,subscription_status,plan_key,billing_exempt,classification) values('Empty Setup Audit','active','standard',true,'test') returning id");
  const setupUser=await queryOne<{id:string}>("insert into users(email,password_hash,role,name) values('ui-setup@example.test',$1,'operator','Setup Audit') returning id",[hashPassword('DisposableUiAudit123!')]);
  await query("insert into organization_members(org_id,user_id,role) values($1,$2,'owner')",[setupOrg!.id,setupUser!.id]);
  await query("insert into company_profile(org_id,version,is_active,profile_json,profile_text,updated_by) values($1,1,true,$2,'Synthetic incomplete profile','ui-audit')",[setupOrg!.id,JSON.stringify(defaultCompanyProfile({legalName:'Empty Setup Audit',email:'ui-setup@example.test'}))]);
  await query(`insert into agent_logs(org_id,agent,action,level,message,output_json,created_at)
    values($1,'analytics-engine','kpi-snapshot','info','Synthetic stored report evidence',$2,now()-interval '8 days')`,[org!.id,JSON.stringify({
      win_rate:{by_naics:[{key:'561210',won:2,lost:2,win_rate:50}],by_agency:[{key:'Audit Agency',won:2,lost:2,win_rate:50}],
        by_geography:[{key:'ID',won:2,lost:2,win_rate:50}]},
      // Producer-shaped projection, deliberately missing one horizon to test unknown data.
      cash_flow_projection:{window_days:[30,60,90],buckets:[{days:30,amount:1000},{days:90,amount:3000}],basis:'milestones'},
      sub_reliability_rankings:[{company_name:'Sample Electrical Services',reliability_score:95}],
      pipeline_velocity:{note:'counts per stage (not durations)',by_stage:[{stage:'scoring',count:2},{stage:'dismissed',count:1}]}
    })]);
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
  writeFileSync("/tmp/ui-fixtures.json",JSON.stringify({org:org!.id,opportunity:opp!.id,research:research!.id,archived:archived!.id,sourceAudit:sourceAudit!.id,sourceDocs:sourceDocs.map(d=>d.id),sub:sub!.id,contract:contract!.id,call:call!.id,vendorToken:encodePortalToken({s:sub!.id,e:Math.floor(Date.now()/1000)+3600})}));
} finally { await closePool(); }

}
main().catch(error => { console.error(error); process.exitCode=1; });
