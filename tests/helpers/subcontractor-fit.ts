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
