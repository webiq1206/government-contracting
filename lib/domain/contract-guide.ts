import type { ContractRecord } from "@/lib/contract-record";
import type { PageGuide } from "./page-guide";
import { contractRisks } from "./contract-status";

export function contractIdFromPath(path: string): string | null {
  return path.match(/^\/contracts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i)?.[1] ?? null;
}

/** Facts from one authorized record. Source file contents are not included. */
export function buildContractGuide(record: ContractRecord): PageGuide {
  const { header: h, money } = record;
  const path = `/contracts/${h.id}`;
  const short = (text: string | null | undefined) => text?.slice(0, 300) || "Not recorded";
  const amount = (cents: number | null) => cents === null ? "Not recorded" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const risks = contractRisks({ status: h.status, startDate: h.start_date, endDate: h.end_date,
    nonSsSubPct: h.non_ss_sub_pct, cparsDueAt: h.cpars_due_at, cparsStatus: h.cpars_status,
    milestones: record.milestones.map(m => ({ name: m.name, due: m.due_at ?? undefined, status: m.completed_at ? "complete" : "not started" })),
  });
  const outstanding = record.milestones.filter(m => !m.completed_at);
  const openIssues = record.issues.filter(i => !i.resolved_at);
  const needsAttention = [
    ...risks.map(r => r.detail),
    ...outstanding.slice(0, 8).map(m => `Outstanding: ${short(m.name)}. Due: ${m.due_at || "Not recorded"}.`),
    ...openIssues.slice(0, 8).map(i => `Open issue: ${short(i.title)}. Severity: ${i.severity}.`),
  ];
  return {
    pageKey: "contracts", pathname: path, experience: "familiar",
    headline: `Review ${short(h.contract_number || h.opportunity_title)}`,
    situation: [
      `Recorded status: ${h.status}. Agency: ${short(h.agency)}.`,
      `Period: ${h.start_date || "Not recorded"} to ${h.end_date || "Not recorded"}.`,
      `Current contract value: ${amount(money.currentValueCents)}. Invoiced: ${amount(money.invoicedCents)}. Paid: ${amount(money.paidCents)}. Outstanding: ${amount(money.outstandingCents)}.`,
      `${outstanding.length} outstanding milestones; ${openIssues.length} open issues; ${record.coordination.length} coordination entries.`,
      ...record.modifications.filter(m => !m.superseded_by).slice(0, 5).map(m => `Recorded modification ${short(m.mod_number)}: ${short(m.summary)}. Document: ${short(m.source_document)}. Source note: ${short(m.source_note)}.`),
    ].join("\n"),
    stageLabel: h.status,
    completed: record.milestones.filter(m => m.completed_at).slice(0, 8).map(m => `Delivered: ${short(m.name)} (${m.completed_at?.slice(0, 10)}).`),
    needsAttention, brostHandling: [],
    whatHappensNext: "Review the recorded obligations and issues. Check source documents before recording a modification.",
    steps: [
      { id: "contract-obligations", title: "Review obligations", why: `${outstanding.length} milestones remain outstanding in the record.`, cta: "Open obligations", href: `${path}#obligations`, tone: outstanding.length ? "action" : "info", owner: "you", kind: "link", source: "page" },
      { id: "contract-evidence", title: "Check sources and modifications", why: "Review recorded changes and their stated sources before changing the contract.", cta: "Open documents", href: `${path}#documents`, tone: "info", owner: "you", kind: "link", source: "page" },
    ],
    idle: needsAttention.length === 0, pageExplain: null, terms: [], scoreExplain: null,
    badgeCount: needsAttention.length, automationPaused: false,
    dataWarnings: ["These are recorded contract facts. Source file contents and current automation status were not checked for this answer."],
  };
}
