import {orgsToSweep} from "./org-fanout";
import {reconcileMailboxForOrg} from "../mailbox-reconcile";
import type {AgentDefinition} from "./types";

export const mailboxSync:AgentDefinition={
  name:"mailbox-sync",label:"Mailbox history sync",worksWithoutClaude:true,
  description:"Observes verified Gmail sent receipts and known incoming conversations without sending or paid interpretation. Capture continues during account pause; the platform pause still stops it.",
  async handler(){
    const fanout=await orgsToSweep("mailbox-sync");
    if(fanout.error)return {ok:false,summary:fanout.error};
    const results=[];
    for(const org of fanout.orgs){
      try{results.push(await reconcileMailboxForOrg(org.id));}
      catch{results.push({ok:false,summary:"Mailbox history could not be reconciled for one account. No send or cursor advance was inferred."});}
    }
    return {ok:results.every(r=>r.ok),summary:results.map(r=>r.summary).join(" ") || "No accounts available for mailbox history sync."};
  },
};
