/**
 * Repair conversations recorded wrongly before the bounce and threading fixes.
 *
 *   npm run repair:email-history            # DRY RUN: reports, changes nothing
 *   npm run repair:email-history -- --apply # writes the repairs
 *
 * Three faults, all now fixed at the source, all still sitting in the data:
 *
 *   1. A delivery-status report filed as an inbound REPLY. The detector missed
 *      "Message blocked", "Undelivered Mail Returned to Sender" and several
 *      other ordinary provider subject lines, so those notices were matched to
 *      a subcontractor by thread and read as though the firm had written back.
 *      Every one of them marks an outreach responsive, satisfies trade
 *      coverage nobody has, and leaves an operator waiting for a quote that
 *      cannot arrive.
 *
 *   2. A subcontractor still flagged email_verified after a hard bounce.
 *      Suppression stopped us mailing the address, and stopped there: the
 *      roster went on presenting a refused address as verified.
 *
 *   3. A pairing left at 'sent' or 'followed_up' whose only evidence of
 *      contact was one of those bounces -- inside the CONTACTED set, so the
 *      trade read as covered and a bid could advance on coverage that did not
 *      exist.
 *
 * SAFETY, layered. This rewrites history in a live database, so the bar is the
 * same as the org purge:
 *
 *   1. Dry run by default. Nothing is written without an explicit --apply.
 *   2. Reclassification, never deletion. A misfiled reply becomes an inbound
 *      row marked as a delivery report; the message, its body, its envelope
 *      and its thread are all preserved. If this tool is wrong about a row, the
 *      evidence to say so is still there.
 *   3. A row is a candidate only if looksLikeBounce agrees -- the same
 *      function the live path now uses, so the repair and the fix cannot
 *      disagree about what a bounce is.
 *   4. A reply that produced a QUOTE is never touched, whatever it looks like.
 *      A price is the strongest possible evidence that a human wrote it, and
 *      no heuristic gets to overrule that.
 *   5. A blast-radius cap: it refuses to write more than MAX_REPAIR rows in one
 *      run without --force, so a matcher bug cannot rewrite the whole table.
 *   6. Everything runs in one transaction. Any failure rolls the whole run
 *      back, leaving the database exactly as it was.
 *   7. --org <id> confines a run to one organization.
 */
import "../lib/env";
import { query, queryOne, transaction, closePool } from "../lib/db";
import { looksLikeBounce, parseBounce } from "../lib/domain/email-delivery";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const ORG = (() => {
  const i = process.argv.indexOf("--org");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const MAX_REPAIR = 500;

interface MisfiledReply {
  id: string;
  org_id: string | null;
  subcontractor_id: string | null;
  opportunity_id: string | null;
  company_name: string | null;
  opportunity_title: string | null;
  subject: string | null;
  body: string | null;
  recipient_email: string | null;
  created_at: string;
  has_quote: boolean;
}

function line(s = ""): void {
  console.log(s);
}

function head(title: string): void {
  line();
  line(`── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);
}

async function findMisfiledReplies(): Promise<MisfiledReply[]> {
  /*
   * Inbound rows are the only candidates: an outbound row is something we
   * sent, and a bounce is something we received. The window is deliberately
   * unbounded -- this is a one-off repair of history, and the oldest rows are
   * the ones that have had the longest to mislead.
   */
  const rows = await query<MisfiledReply>(
    `select c.id, c.org_id, c.subcontractor_id, c.opportunity_id,
            s.company_name, o.title as opportunity_title,
            c.subject, c.body, c.recipient_email, c.created_at,
            exists (
              select 1 from quotes q
               where q.opportunity_id = c.opportunity_id
                 and q.subcontractor_id = c.subcontractor_id
            ) as has_quote
       from communications c
       left join subcontractors s on s.id = c.subcontractor_id
       left join opportunities o on o.id = c.opportunity_id
      where c.direction = 'inbound'
        and c.channel = 'email'
        and coalesce(c.delivery_state, '') not in ('bounced','deferred','failed')
        ${ORG ? "and c.org_id = $1" : ""}
      order by c.created_at asc`,
    ORG ? [ORG] : []
  );

  return rows.filter((r) => {
    // A reply that produced a price is a human. Nothing overrules that.
    if (r.has_quote) return false;
    return looksLikeBounce({
      from: r.recipient_email,
      subject: r.subject,
      body: r.body,
    });
  });
}

interface StaleVerified {
  id: string;
  company_name: string;
  email: string;
  reason: string;
}

async function findStaleVerified(): Promise<StaleVerified[]> {
  /*
   * Suppression is the record of a hard bounce we acted on, so it is the
   * authority here rather than re-reading message bodies. A subcontractor
   * whose address is suppressed for a bounce, and who is still flagged
   * verified, is the exact contradiction this repairs.
   */
  return query<StaleVerified>(
    `select s.id, s.company_name, s.email, e.reason
       from subcontractors s
       join email_suppressions e
         on e.org_id = s.org_id and lower(e.email) = lower(s.email)
      where s.email_verified
        and e.source = 'bounce'
        ${ORG ? "and s.org_id = $1" : ""}
      order by s.company_name`,
    ORG ? [ORG] : []
  ).catch(() => []);
}

interface OverstatedCoverage {
  id: string;
  opportunity_title: string | null;
  company_name: string | null;
  trade: string | null;
  outreach_state: string;
}

async function findOverstatedCoverage(): Promise<OverstatedCoverage[]> {
  /*
   * Pairings claiming contact was made to an address a receiving server
   * refused. Rows that reached 'responsive' or 'quoted' are excluded: those
   * have a real reply behind them, and a later bounce on the same address
   * must not erase it.
   */
  return query<OverstatedCoverage>(
    `select os.id, o.title as opportunity_title, s.company_name, os.trade, os.outreach_state
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id
       join subcontractors s on s.id = os.subcontractor_id
       join email_suppressions e
         on e.org_id = s.org_id and lower(e.email) = lower(s.email) and e.source = 'bounce'
      where os.outreach_state in ('sent','followed_up')
        and o.status = 'open'
        ${ORG ? "and o.org_id = $1" : ""}
      order by o.title, s.company_name`,
    ORG ? [ORG] : []
  ).catch(() => []);
}

async function main(): Promise<void> {
  line("Email history repair");
  line(APPLY ? "MODE: APPLY — changes will be written." : "MODE: DRY RUN — nothing will be written.");
  if (ORG) line(`Scope: organization ${ORG}`);

  const [misfiled, staleVerified, coverage] = await Promise.all([
    findMisfiledReplies(),
    findStaleVerified(),
    findOverstatedCoverage(),
  ]);

  head("1. Delivery reports filed as replies");
  if (misfiled.length === 0) {
    line("  None. Every inbound row reads as a genuine message.");
  } else {
    for (const m of misfiled) {
      const reason = parseBounce(m.body ?? "").reason;
      line(`  • ${m.company_name ?? "unknown sub"} — ${m.opportunity_title ?? "no opportunity"}`);
      line(`    subject: ${(m.subject ?? "(none)").slice(0, 90)}`);
      line(`    why:     ${reason.slice(0, 90)}`);
      line(`    dated:   ${new Date(m.created_at).toISOString().slice(0, 10)}   row ${m.id}`);
    }
    line();
    line(`  ${misfiled.length} row(s) would be re-marked as delivery reports.`);
    line("  The message, body, envelope and thread are all kept; only the");
    line("  classification changes, so this is reversible by inspection.");
  }

  head("2. Subcontractors still 'email verified' after a hard bounce");
  if (staleVerified.length === 0) {
    line("  None.");
  } else {
    for (const s of staleVerified) {
      line(`  • ${s.company_name} <${s.email}>`);
      line(`    ${s.reason.slice(0, 100)}`);
    }
    line();
    line(`  ${staleVerified.length} subcontractor(s) would have email_verified cleared.`);
  }

  head("3. Trade coverage claiming contact a bounce disproved");
  if (coverage.length === 0) {
    line("  None.");
  } else {
    for (const c of coverage) {
      line(`  • ${c.company_name ?? "unknown"} (${c.trade ?? "no trade"}) — ${c.opportunity_title ?? "untitled"}`);
      line(`    ${c.outreach_state} → send_failed`);
    }
    line();
    line(`  ${coverage.length} pairing(s) would move out of the contacted set.`);
    line("  Live opportunities only: a closed bid's history is left as it was.");
  }

  const total = misfiled.length + staleVerified.length + coverage.length;
  head("Summary");
  line(`  ${misfiled.length} misfiled repl${misfiled.length === 1 ? "y" : "ies"}`);
  line(`  ${staleVerified.length} stale verified address(es)`);
  line(`  ${coverage.length} overstated coverage row(s)`);
  line(`  ${total} change(s) in total.`);

  if (total === 0) {
    line();
    line("Nothing to repair.");
    return;
  }

  if (!APPLY) {
    line();
    line("Dry run: nothing was written.");
    line("Review the list above, then re-run with --apply to make these changes.");
    return;
  }

  if (total > MAX_REPAIR && !FORCE) {
    line();
    line(`REFUSING to write ${total} changes in one run (cap ${MAX_REPAIR}).`);
    line("That is more than a repair of this kind should ever need, which usually");
    line("means a matcher is wrong rather than that the data is that broken.");
    line("Re-read the list above. Pass --force if it is genuinely correct.");
    process.exitCode = 1;
    return;
  }

  /*
   * One transaction for the whole run. A partial repair is the worst outcome
   * available here: it would leave the three faults inconsistent with each
   * other, and no way to tell from the data which parts had been done.
   */
  await transaction(async (tx) => {
    for (const m of misfiled) {
      const reason = parseBounce(m.body ?? "").reason;
      await tx.query(
        `update communications
            set delivery_state = 'bounced',
                delivery_detail = $2,
                delivery_updated_at = now(),
                meta = coalesce(meta, '{}'::jsonb) || $3::jsonb
          where id = $1`,
        [
          m.id,
          reason.slice(0, 300),
          JSON.stringify({
            reclassified: {
              by: "repair-email-history",
              from: "reply",
              to: "delivery-report",
              at: new Date().toISOString(),
            },
          }),
        ]
      );
      // The outbound message it was wrongly recorded as answering.
      await tx.query(
        `update communications
            set replied_at = null
          where org_id is not distinct from $1
            and direction = 'outbound'
            and subcontractor_id is not distinct from $2
            and opportunity_id is not distinct from $3
            and replied_at is not null
            and not exists (
              select 1 from communications r
               where r.direction = 'inbound'
                 and r.subcontractor_id is not distinct from $2
                 and r.opportunity_id is not distinct from $3
                 and coalesce(r.delivery_state,'') not in ('bounced','deferred','failed')
            )`,
        [m.org_id, m.subcontractor_id, m.opportunity_id]
      );
    }

    for (const s of staleVerified) {
      await tx.query(`update subcontractors set email_verified = false where id = $1`, [s.id]);
    }

    for (const c of coverage) {
      await tx.query(`update opportunity_subs set outreach_state = 'send_failed' where id = $1`, [
        c.id,
      ]);
    }
  });

  line();
  line(`Applied ${total} change(s).`);
  line("Run `npm run doctor` to confirm the engine's own reading agrees.");
}

main()
  .catch((err) => {
    console.error(`\nrepair failed: ${(err as Error).message}`);
    console.error("Nothing was written: the whole run is one transaction.");
    process.exitCode = 1;
  })
  .finally(() => closePool());
