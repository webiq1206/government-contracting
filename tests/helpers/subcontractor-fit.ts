import { fitContext, reviewedFit, type FitContextInput } from "../../lib/domain/subcontractor-fit";

/** Synthetic, explicitly reviewed evidence. Never used in production or to research a real firm. */
export function syntheticFit(opp:FitContextInput,sub:string,trade:string) {
  const key=fitContext(opp,sub,trade);
  if(!key)throw Error("The synthetic positive fixture needs a trade scope and location.");
  return {outreach_fit:reviewedFit({affirmed:true,
    serviceArea:{kind:"supplier_reply",reference:"synthetic-coverage-reply",statement:"The synthetic supplier explicitly confirmed coverage of the project's location."},
    capability:{kind:"confirmed_call",reference:"synthetic-scope-review",statement:`The synthetic supplier confirmed it performs the full ${trade} scope shown in this fixture.`},
  },key,"synthetic-reviewer")};
}

/** Existing canonical integration fixtures explicitly opt into reviewed fit. */
export async function seedSyntheticFit(orgId:string,opportunityId:string,subcontractorId:string,trade:string) {
  const {query,queryOne}=await import("../../lib/db");
  const opp=await queryOne<FitContextInput>("select * from opportunities where id=$1 and org_id=$2",[opportunityId,orgId]);
  if(!opp)throw Error("Missing synthetic opportunity");
  await query(`update opportunity_subs set verification_json=coalesce(verification_json,'{}'::jsonb)||$5::jsonb
    where org_id=$1 and opportunity_id=$2 and subcontractor_id=$3 and trade=$4`,
    [orgId,opportunityId,subcontractorId,trade,JSON.stringify(syntheticFit(opp,subcontractorId,trade))]);
}
