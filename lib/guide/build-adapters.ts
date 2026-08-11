/**
 * Server-only: attach live action payloads to a PageGuide so the wizard can
 * complete work in-panel (quotes, calls, compliance, weights, sub contact).
 */

import type { ActionCenterData } from "@/lib/data";
import type {
  GuideAdapters,
  OpportunityGuideFacts,
  PageGuide,
  SubGuideFacts,
} from "@/lib/domain/page-guide";

export function buildGuideAdapters(opts: {
  guide: PageGuide;
  actions: ActionCenterData | null;
  opportunity: OpportunityGuideFacts | null;
  opportunitySubs?: {
    subcontractor_id: string;
    company_name: string;
    trade: string | null;
  }[];
  sub: SubGuideFacts | null;
  subRow?: {
    id: string;
    company_name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    owner_name: string | null;
  } | null;
}): GuideAdapters {
  const adapters: GuideAdapters = {};
  const { guide, actions, opportunity, opportunitySubs, sub, subRow } = opts;

  const needs = new Set(
    guide.steps.map((s) => s.adapter).filter((a): a is NonNullable<typeof a> => Boolean(a))
  );
  if (guide.steps.some((s) => s.kind === "enter-quote")) needs.add("quote");
  if (guide.steps.some((s) => s.kind === "open-call")) {
    needs.add("call");
    needs.add("followUp");
  }
  if (guide.steps.some((s) => s.kind === "edit-sub-contact")) needs.add("subContact");
  if (guide.steps.some((s) => s.kind === "compliance-update")) needs.add("compliance");
  if (guide.steps.some((s) => s.kind === "approve-weights")) needs.add("weights");
  if (guide.steps.some((s) => s.kind === "review-quote")) needs.add("quoteReview");
  if (guide.steps.some((s) => s.kind === "submit-package")) needs.add("package");
  if (guide.steps.some((s) => s.kind === "upload-document")) needs.add("upload");

  if (needs.has("quote")) {
    const oppId =
      opportunity?.id ||
      guide.steps.find((s) => s.kind === "enter-quote")?.opportunityId ||
      actions?.bidWork[0]?.id;
    if (oppId) {
      adapters.quote = {
        opportunityId: oppId,
        subs: opportunitySubs ?? [],
      };
    }
  }

  if (needs.has("call") || needs.has("followUp")) {
    const card = actions?.calls.rows[0];
    if (card) {
      adapters.call = {
        cardId: card.id,
        companyName: card.company_name,
        opportunityTitle: card.opportunity_title,
      };
    }
    const fu = actions?.subFollowUps[0];
    if (fu) {
      adapters.followUp = {
        opportunityId: fu.opportunity_id,
        subcontractorId: fu.subcontractor_id,
        companyName: fu.company_name,
        phone: fu.phone,
        trade: fu.trade,
        opportunityTitle: fu.opportunity_title,
      };
    }
  }

  if (needs.has("compliance")) {
    const item = actions?.complianceAlerts[0];
    if (item) {
      adapters.compliance = {
        id: item.id,
        label: item.label,
        status: item.status,
        dueAt: item.due_at,
      };
    }
  }

  if (needs.has("weights")) {
    const w = actions?.proposedWeights[0];
    if (w) {
      adapters.weights = {
        id: w.id,
        version: w.version,
        rationale: w.rationale,
      };
    }
  }

  if (needs.has("subContact") && (subRow || sub)) {
    adapters.subContact = {
      id: subRow?.id ?? sub!.id,
      companyName: subRow?.company_name ?? sub!.companyName,
      email: subRow?.email ?? sub?.email ?? null,
      phone: subRow?.phone ?? sub?.phone ?? null,
      website: subRow?.website ?? null,
      ownerName: subRow?.owner_name ?? null,
    };
  }

  if (needs.has("quoteReview")) {
    const q = actions?.quoteReviews[0];
    if (q) {
      adapters.quoteReview = {
        quoteId: q.quote_id,
        opportunityId: q.opportunity_id,
        opportunityTitle: q.opportunity_title,
        companyName: q.company_name,
        trade: q.trade,
        quoteAmount: q.quote_amount,
      };
    }
  }

  if (needs.has("package") || needs.has("upload")) {
    const oppId =
      opportunity?.id ||
      guide.steps.find((s) => s.opportunityId)?.opportunityId ||
      null;
    if (oppId) {
      if (needs.has("package")) {
        adapters.package = {
          opportunityId: oppId,
          packageReady: opportunity?.packageReady ?? null,
          blockers: opportunity?.packageBlockers ?? [],
          submitted: Boolean(opportunity?.bidSubmitted),
        };
      }
      if (needs.has("upload")) {
        adapters.upload = { opportunityId: oppId };
      }
    }
  }

  return adapters;
}
