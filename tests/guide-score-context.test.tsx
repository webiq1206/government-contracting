import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GuideScoreDetails } from "@/components/guide-score-details";
import { currentScoreLine, recordedDeadlineLine, scoreHistoryNotice } from "@/lib/domain/guide-score-context";
it("keeps the current score outside collapsed, explicitly historical prose", () => {
  const html=renderToStaticMarkup(<GuideScoreDetails scoreLine={currentScoreLine(67,'review')}
    explanation={{total:67,summary:'Saved claim: 75 and automatic pursuit',factors:[{label:'Timing',points:10,max:10,reasoning:'Weeks remain'}]}} />);
  expect(html).toContain('Current recorded score: 67/100'); expect(html).toContain('Recorded tier: review');
  expect(html.indexOf('not been verified')).toBeLessThan(html.indexOf('<details'));
  expect(html).toContain('Saved scoring analysis (recorded total 67)'); expect(html).not.toContain('<details open');
  expect(html).toContain('Saved claim: 75 and automatic pursuit'); expect(html).toContain('Weeks remain');
});
it.each([null,Number.NaN])('does not replace unknown current score %s with the saved total', score => {
  expect(currentScoreLine(score,'review')).toContain('Current score unavailable');
  expect(scoreHistoryNotice(score,75)).toContain('not been verified');
});
it.each(['2026-10-06T22:00:00Z','2026-10-05T22:00:00Z'])('uses absolute UTC instead of a stale urgency claim for %s', deadline => {
  const line=recordedDeadlineLine(deadline);expect(line).toContain('2026');expect(line).toContain('UTC');expect(line).not.toMatch(/remaining|runway|hour away/i);
});
it.each(['invalid','2026-10-06T22:00:00','2026-10-06','2026-02-30','2026-02-30T22:00:00Z','2026-10-06T24:00:00Z'])('does not guess an invalid or ambiguous deadline %s', deadline => {
  expect(recordedDeadlineLine(deadline)).toBe('Recorded deadline unavailable.');
});
it('labels absent deadlines without inventing one', () => expect(recordedDeadlineLine(null)).toBe('No deadline recorded.'));
