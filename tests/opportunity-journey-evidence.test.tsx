import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { OpportunityJourney } from '@/components/opportunity-journey';
import { journeySteps, JOURNEY_STAGES } from '@/lib/domain/journey';
import { verifiedGuideProgress, verifiedJourneyCompletion } from '@/lib/domain/guide-progress';
import { summarizeTradeCoverage } from '@/lib/domain/trade-coverage';

const source = { analysisInputHash: 'synthetic-source-hash', completeness: { ok: true, missing: [] } };
const qualified = { trade: 'Roofing', verified: true, outreach_state: 'sent', emails_sent: 1, calls_logged: 0 };
function completion(subs: (typeof qualified & { removed_at?: string })[] = [], sourceEvidence = source, trades = ['Roofing']) {
  const active = subs.filter(s => !s.removed_at);
  return verifiedJourneyCompletion({ score: 67, quoteCount: 0, hasBid: false, bidSubmitted: false,
    progress: verifiedGuideProgress({ sourceEvidence, subs,
      coverage: summarizeTradeCoverage({ requiredTrades: trades, subs: active, quotes: [] }) }) });
}
function completeLabels(stage: string, evidence: ReturnType<typeof completion>, callsEnabled = true) {
  const { document } = parseHTML(renderToStaticMarkup(<OpportunityJourney stage={stage} completion={evidence} callsEnabled={callsEnabled}/>));
  return [...document.querySelectorAll('li[aria-label]')]
    .filter(e => /: complete(?:;|$)/.test(e.getAttribute('aria-label')!))
    .map(e => e.getAttribute('aria-label')!.split(':')[0]);
}

describe('opportunity workflow records evidence rather than ordinal stage', () => {
  it('reproduces GOCO: unavailable links, incomplete source and no owned roster never earn completion ticks', () => {
    const evidence = completion([], { analysisInputHash: '', completeness: { ok: false, missing: [] } }, ['Fuel operations', 'Hazmat']);
    expect(completeLabels('call_queue', evidence)).toEqual(['Found', 'Scored']);
    const html = renderToStaticMarkup(<OpportunityJourney stage="call_queue" completion={evidence}/>);
    expect(html).not.toMatch(/Analyzed|Subs found|Subs contacted|Calls made/);
    expect(html).toContain('Analysis: completion not verified');
    expect(html).toContain('Calls: completion not verified; recorded stage');
    expect(html).not.toContain('animate-pulse');
  });

  it.each([...JOURNEY_STAGES, 'won', 'lost', 'archived', 'unknown'])('stage %s alone never completes work', stage => {
    expect(journeySteps(stage).some(s => s.status === 'done')).toBe(false);
  });

  it.each([false, undefined, null])('requires positive qualification, not a candidate or unknown result (%s)', verified => {
    const subs = [{ ...qualified, verified }];
    const progress = verifiedGuideProgress({ sourceEvidence: source, subs,
      coverage: summarizeTradeCoverage({ requiredTrades: ['Roofing'], subs, quotes: [] }) });
    expect(progress.subsFound).toBe(false);
    expect(progress.subsContacted).toBe(false);
  });

  it('keeps current source review ahead of old qualified/contacted candidates', () => {
    expect(completeLabels('submitted', completion([qualified], { analysisInputHash: '', completeness: { ok: true, missing: [] } })))
      .toEqual(['Found', 'Scored']);
  });

  it('requires qualified coverage and receipts on each trade', () => {
    expect(completeLabels('call_queue', completion([qualified], source, ['Roofing', 'Electrical'])))
      .toEqual(['Found', 'Scored', 'Analyzed']);
    const uncontacted = { ...qualified, trade: 'Electrical', emails_sent: 0 };
    expect(completeLabels('call_queue', completion([qualified, uncontacted], source, ['Roofing', 'Electrical'])))
      .toEqual(['Found', 'Scored', 'Analyzed', 'Subs found']);
  });

  it.each(['declined', 'not_a_fit', 'unavailable'])('does not count a %s firm even when historical receipts exist', outreach_state => {
    expect(completeLabels('call_queue', completion([{ ...qualified, outreach_state }])))
      .toEqual(['Found', 'Scored', 'Analyzed']);
  });

  it('does not count a removed qualified firm or its receipts', () => {
    expect(completeLabels('call_queue', completion([{ ...qualified, removed_at: '2026-10-01' }])))
      .toEqual(['Found', 'Scored', 'Analyzed']);
  });

  it('preserves actual positive evidence even when the saved stage has not advanced', () => {
    expect(completeLabels('analysis', completion([qualified])))
      .toEqual(['Found', 'Scored', 'Analyzed', 'Subs found', 'Subs contacted']);
  });

  it('does not let quotes, a bid or submission backfill missing prerequisite evidence', () => {
    const evidence = verifiedJourneyCompletion({ score: null, quoteCount: 1, hasBid: true, bidSubmitted: true });
    expect(completeLabels('won', evidence)).toEqual(['Found', 'Quotes in', 'Bid built', 'Submitted']);
  });

  it('preserves recorded calls without promising delivery and respects calling-off presentation', () => {
    const evidence = completion([{ ...qualified, emails_sent: 0, calls_logged: 1 }]);
    expect(completeLabels('quote_entry', evidence)).toContain('Calls recorded');
    expect(completeLabels('quote_entry', evidence, false)).not.toContain('Calls recorded');
    expect(JSON.stringify(evidence)).not.toContain('delivered');
  });
});
