/** Offline only: prints a bounded evaluation proposal, never imports DB,
 * credentials, application agents, or a provider client. No opt-in executes it. */
import { MODEL_MIGRATION_GOLD } from "../tests/fixtures/model-migration-gold";
import { GPT6_RATES } from "../lib/ai/model-contracts";
const fixtures = MODEL_MIGRATION_GOLD.map(fixture => {
  const rates = GPT6_RATES[fixture.model];
  const providerCeiling = fixture.outputCaps.reduce((sum,output) =>
    sum + (272000 * Number(rates.input_tokens) + output * Number(rates.output_tokens))/1000000,0);
  return {...fixture,status:"UNRUN",inputTokensPerAttemptCeiling:272000,reasoning:"none",providerCeilingUsd:providerCeiling,
    heldReservationUsd:fixture.outputCaps.length*3};
});
const ceiling = fixtures.reduce((sum,fixture)=>sum+fixture.providerCeilingUsd,0);
console.log(JSON.stringify({mode:"offline-plan-only",paidCalls:0,authorizedPaidBudgetUsd:null,fixtures,
  maximumAttempts:fixtures.reduce((sum,fixture)=>sum+fixture.outputCaps.length,0),
  providerCeilingUsd:Number(ceiling.toFixed(12)),withLedgerBufferUsd:Number((ceiling*1.1).toFixed(12)),
  heldReservationUsd:15,acceptedPlatformReservationWithMarkupUsd:18.75,
  blockers:["No verified scoped evaluation spending authorization or isolated runtime.",
    "Add labeled PDF/scanned-document, missing-file and citation gold cases and verify their token-cost contract before production selection.",
    "No production SQL, replay, sends, or provider recovery calls are part of this proposal."]},null,2));
