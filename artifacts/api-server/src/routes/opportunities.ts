import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../lib/session-middleware";
import { query, queryOne } from "../lib/db";
import { storage } from "../engine/integrations/storage";

const router = Router();
router.use(requireAuth);

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

router.get("/", async (req: Request, res: Response) => {
  const { stage, tier, human_action_required, limit } = req.query;
  const where: string[] = ["stage <> 'dismissed'", "status <> 'archived'"];
  const params: unknown[] = [];

  if (stage) { params.push(stage); where.push(`stage = $${params.length}`); }
  if (tier) { params.push(tier); where.push(`tier = $${params.length}`); }
  if (human_action_required === "true") where.push("human_action_required = true");

  const lim = Math.min(Number(limit ?? 500), 1000);
  const rows = await query(
    `select o.*,
            count(cc.quote_amount)::int          as bid_quote_count,
            min(cc.quote_amount)                 as bid_min_quote
       from opportunities o
       left join call_cards cc
              on cc.opportunity_id = o.id
             and cc.quote_amount is not null
      where ${where.map((w) => `o.${w}`).join(" and ")}
      group by o.id
      order by (o.deadline is null), o.deadline asc
      limit ${lim}`,
    params
  );
  res.json(rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const row = await queryOne(`select * from opportunities where id = $1`, [req.params.id]);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const bidSummary = await queryOne<{
    quote_count: string;
    min_quote: string | null;
    max_quote: string | null;
    avg_quote: string | null;
  }>(
    `select count(quote_amount)::text as quote_count,
            min(quote_amount)::text as min_quote,
            max(quote_amount)::text as max_quote,
            round(avg(quote_amount))::text as avg_quote
       from call_cards
      where opportunity_id = $1 and quote_amount is not null`,
    [req.params.id]
  );

  // Attachments (solicitation documents + generated files) for the bid-brief view.
  const documents = await query<{
    id: string;
    kind: string;
    name: string;
    mime: string | null;
    created_at: string;
    meta: Record<string, unknown> | null;
  }>(
    `select id, kind, name, mime, created_at, meta
       from documents where opportunity_id = $1
      order by (kind <> 'solicitation'), name asc`,
    [req.params.id]
  );

  res.json({
    ...(row as Record<string, unknown>),
    bid_quote_count: Number(bidSummary?.quote_count ?? 0),
    bid_min_quote: bidSummary?.min_quote != null ? Number(bidSummary.min_quote) : null,
    bid_max_quote: bidSummary?.max_quote != null ? Number(bidSummary.max_quote) : null,
    bid_avg_quote: bidSummary?.avg_quote != null ? Number(bidSummary.avg_quote) : null,
    documents: documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      mime: d.mime,
      created_at: d.created_at,
      source_url: (d.meta as { source_url?: string } | null)?.source_url ?? null,
      download_url: `/api/opportunities/${req.params.id}/documents/${d.id}`,
    })),
  });
});

/** Serve a stored attachment: redirect to a Supabase signed URL, or stream the local copy. */
router.get("/:id/documents/:docId", async (req: Request, res: Response) => {
  const doc = await queryOne<{ name: string; storage_path: string | null; storage_backend: string; mime: string | null }>(
    `select name, storage_path, storage_backend, mime from documents where id = $1 and opportunity_id = $2`,
    [req.params.docId, req.params.id]
  );
  if (!doc || !doc.storage_path) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  try {
    const signed = await storage.signedUrl(doc.storage_path);
    if (signed && signed.startsWith("http") && !signed.includes("/api/")) {
      res.redirect(signed);
      return;
    }
    const buf = await storage.download(doc.storage_path, doc.storage_backend as "supabase" | "local");
    const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
    res.setHeader("Content-Type", doc.mime || MIME_BY_EXT[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.name.replace(/"/g, "")}"`);
    res.end(buf);
  } catch {
    res.status(404).json({ error: "File unavailable" });
  }
});

router.get("/:id/quotes", async (req: Request, res: Response) => {
  const rows = await query(
    `select cc.id as card_id, cc.subcontractor_id, cc.quote_amount, cc.status,
            cc.called_at, cc.response_json,
            s.company_name, s.phone, s.email, s.trade_categories
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
      where cc.opportunity_id = $1
      order by cc.quote_amount asc nulls last, cc.called_at desc`,
    [req.params.id]
  );
  res.json(rows);
});

const VALID_OUTCOMES = ["quoted", "not_interested", "callback", "voicemail"];

router.post("/:id/quotes", async (req: Request, res: Response) => {
  const { subcontractor_id, quote_amount, outcome, notes } = req.body ?? {};
  if (!subcontractor_id || quote_amount == null) {
    res.status(400).json({ error: "subcontractor_id and quote_amount are required" });
    return;
  }
  const resolvedOutcome = outcome && VALID_OUTCOMES.includes(outcome) ? outcome : "quoted";
  const oppId = req.params.id;
  const opp = await queryOne(`select id from opportunities where id=$1`, [oppId]);
  if (!opp) { res.status(404).json({ error: "Opportunity not found" }); return; }

  const sub = await queryOne(`select id from subcontractors where id=$1`, [subcontractor_id]);
  if (!sub) { res.status(404).json({ error: "Subcontractor not found" }); return; }

  const existing = await queryOne<{ id: string }>(
    `select id from call_cards where opportunity_id=$1 and subcontractor_id=$2 limit 1`,
    [oppId, subcontractor_id]
  );

  const patchJson: Record<string, string> = { outcome: resolvedOutcome };
  if (notes) patchJson.notes = String(notes).slice(0, 1000);
  const patchJsonStr = JSON.stringify(patchJson);

  if (existing) {
    await query(
      `update call_cards
          set quote_amount=$1,
              status=$2,
              response_json=coalesce(response_json, '{}'::jsonb) || $3::jsonb
        where id=$4`,
      [Number(quote_amount), resolvedOutcome, patchJsonStr, existing.id]
    );
    res.json({ ok: true, card_id: existing.id, created: false });
  } else {
    const row = await queryOne<{ id: string }>(
      `insert into call_cards (opportunity_id, subcontractor_id, status, quote_amount, card_json, response_json)
       values ($1, $2, $3, $4, '{}'::jsonb, $5::jsonb)
       returning id`,
      [oppId, subcontractor_id, resolvedOutcome, Number(quote_amount), patchJsonStr]
    );
    res.json({ ok: true, card_id: row?.id, created: true });
  }
});

router.post("/:id/action", async (req: Request, res: Response) => {
  const { action, stage } = req.body ?? {};
  const { id } = req.params;

  if (action === "pursue") {
    await query(
      `update opportunities set tier='pursue', stage='analysis', human_action_required=false, updated_at=now() where id=$1`,
      [id]
    );
  } else if (action === "dismiss") {
    await query(
      `update opportunities set tier='dismiss', stage='dismissed', human_action_required=false, updated_at=now() where id=$1`,
      [id]
    );
  } else if (action === "advance" && stage) {
    await query(
      `update opportunities set stage=$1, human_action_required=false, updated_at=now() where id=$2`,
      [stage, id]
    );
  } else {
    res.status(400).json({ error: "Invalid action" });
    return;
  }
  res.json({ ok: true });
});

export default router;
