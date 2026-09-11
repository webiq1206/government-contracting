/** Richer, explicitly synthetic fixtures for layout and product previews. No external calls. */
import {readFileSync} from 'node:fs';
import {startDatabase} from './local-database.mjs';
const {db,server}=await startDatabase();
try{
 const fixtures=JSON.parse(readFileSync('/tmp/ui-fixtures.json','utf8'));
 const {rows}=await db.query("select id from organizations where id=$1 and name='Interface Audit Workspace'",[fixtures.org]);
 if(rows.length!==1)throw Error('Expected disposable audit organization.');
 const examples=[
 ['grounds','Grounds maintenance at a federal campus','sub_research',91,145000,18],
 ['hvac','HVAC maintenance and seasonal inspections','outreach',86,98000,24],
 ['janitorial','Janitorial services for an administrative building','bid_building',88,175000,14],
 ['painting','Interior painting and repairs','submitted',81,67000,30]
 ];
 for(const [id,title,stage,score,value,days] of examples) await db.query(`insert into opportunities(org_id,source,source_id,title,agency,stage,status,score,tier,value_estimated,deadline,location_state,location_text,naics_code,human_action_required)
 select $1,'manual',$2,$3,'Sample Federal Agency',$4,'open',$5,'pursue',$6,now()+($7||' days')::interval,'ID','Boise, ID','561210',false
 where not exists(select 1 from opportunities where org_id=$1 and source_id=$2)`,[fixtures.org,'ui-demo-'+id,title,stage,score,value,String(days)]);
 const analysis={project_overview:'Maintain facility electrical systems and replace aging equipment at a sample federal campus.',scope_plain_language:'Inspect distribution panels and replace identified components. Coordinate planned outages with the facilities team. Test completed work and provide closeout documentation.',location:'Boise, ID',estimated_value:'$125,000',due_date:'September 21, 2026',submission_method:'Follow the solicitation instructions after final review.',qualifications:{licenses:['Electrical contractor license appropriate to the work'],insurance:['Coverage specified in the solicitation'],bonding:[]},prebid_meeting:{required:false,details:'No meeting recorded'},site_visit:{required:false,details:'Confirm access arrangements before pricing'},submission_requirements:['Provide a technical approach.','Include pricing for each required line item.','Complete and sign required agency forms.'],evaluation_criteria:['Technical acceptability','Price','Relevant experience'],required_forms:[],key_dates:[],contacts:[],qa_addenda:[],special_requirements:['Coordinate all outages with the facilities team.'],attention_items:['Confirm access hours before requesting final quotes.'],pursue_recommendation:'Good service and location fit. Review the electrical scope and available subcontractor coverage before pursuing.',required_trades:['Electrical'],estimated_margin_pct:25};
 await db.query(`update opportunities set agency='Sample Federal Agency',location_state='ID',location_text='Boise, ID',naics_code='238210',value_estimated=125000,past_perf_classification='team_accepted',solicitation_analysis=$2 where id=$1`,[fixtures.opportunity,JSON.stringify(analysis)]);
 await db.query(`insert into opportunity_subs(org_id,opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,$3,'Electrical','pending') on conflict(opportunity_id,subcontractor_id,trade) do nothing`,[fixtures.org,fixtures.opportunity,fixtures.sub]);
 for(const [name,trade,city] of [['Sample Mechanical Group','HVAC','Boise'],['Sample Grounds Services','Landscaping','Meridian'],['Sample Facility Care','Janitorial','Nampa']])await db.query(`insert into subcontractors(org_id,company_name,trade_categories,state,city,phone,email) select $1,$2,array[$3],'ID',$4,'2085550101','estimating@example.test' where not exists(select 1 from subcontractors where org_id=$1 and company_name=$2)`,[fixtures.org,name,trade,city]);
 console.log('Synthetic demo opportunity and subcontractor fixtures are ready.');
}finally{await server.stop();await db.close();}
