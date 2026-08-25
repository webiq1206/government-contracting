-- Remember what an analysis was actually computed from.
--
-- Re-analysis is already skipped for an ordinary re-run: an opportunity that
-- has an analysis returns early. But a FORCED run (the manual re-analyze
-- button, a re-pursue, a bulk re-run) always re-bills, and most of the time it
-- is asked for on an opportunity whose documents have not changed at all.
--
-- That is the expensive case, because a solicitation analysis is the largest
-- Claude call this system makes: the whole document set, on the stronger
-- model, with OCR on top when the PDFs are scans. Paying for it twice to
-- produce a byte-identical result is pure waste.
--
-- This stores a hash of the inputs the analysis was derived from, so a forced
-- run can tell "an amendment landed, read it again" apart from "somebody
-- pressed the button twice". Nullable, because every existing analysis
-- predates it: a row with no hash is simply re-analyzed once, which writes the
-- hash and makes every later run cheap.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS analysis_input_hash text;

COMMENT ON COLUMN opportunities.analysis_input_hash IS
  'Hash of the documents and notice text the current solicitation_analysis was computed from. A forced re-analysis whose inputs hash the same is skipped rather than re-billed.';
