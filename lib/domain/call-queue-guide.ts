/**
 * The call-queue guide: three steps that explain the calling workflow in the
 * same checklist language the rest of the product uses.
 *
 * The queue is already sorted (replies first, then soonest deadline), so the
 * guide's whole job is to say: do the top one, here is exactly what will
 * happen when you open it, and saving is the finish line. The first card is
 * named in the live step so "start calling" means one specific company, not
 * a list to size up.
 */

import { assemblePlan, type StepPlan } from "./step-plan";

export interface CallQueueGuideInput {
  first: {
    id: string;
    companyName: string;
    trade: string | null;
    /** Card exists because the sub replied (vs scheduled follow-up). */
    fromReply: boolean;
  };
  queueLength: number;
}

export function buildCallQueueGuide(input: CallQueueGuideInput): StepPlan {
  const who = [input.first.companyName, input.first.trade]
    .filter(Boolean)
    .join(" about ");
  return assemblePlan([
    {
      key: "open",
      n: 1,
      title: "Open the top call",
      plain: input.first.fromReply
        ? `${who} replied to your email, so they are expecting to hear from you.`
        : `${who} is next by deadline. One tap opens the guided workspace.`,
      status: "current",
      owner: "you",
      detail:
        input.queueLength > 1
          ? `${input.queueLength} calls waiting, this one first`
          : undefined,
      action: { label: "Start this call", href: `/call-queue?open=${input.first.id}` },
    },
    {
      key: "talk",
      n: 2,
      title: "Follow the script",
      plain:
        "The workspace shows what to say in plain English, the work they would do, and the questions to ask, with a field for each answer.",
      status: "upcoming",
      owner: "you",
    },
    {
      key: "save",
      n: 3,
      title: "Save the call",
      plain:
        "Saving records the answers on the opportunity; a price re-prices the bid instantly with no separate data entry.",
      status: "upcoming",
      owner: "you",
    },
  ]);
}
