/**
 * One source of truth for which pipeline stages run on their own and which wait
 * for the operator. Used everywhere the pipeline is shown (the Today strip, the
 * Pipeline board) so the "automatic vs needs you" signal is identical site-wide.
 */

export type StageMode = "auto" | "you";

export const STAGE_MODE: Record<string, StageMode> = {
  monitoring: "auto",
  scoring: "auto",
  analysis: "auto",
  sub_research: "auto",
  outreach: "auto",
  call_queue: "you", // you make the calls
  quote_entry: "you", // you enter the quotes
  bid_building: "you", // you review and sign the assembled bid
  submitted: "auto", // waiting on the agency
  won: "you", // you record the outcome / set up the contract
  lost: "you",
  dismissed: "auto",
};

export function stageMode(stage: string): StageMode {
  return STAGE_MODE[stage] ?? "auto";
}
