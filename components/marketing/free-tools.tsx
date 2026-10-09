"use client";
import { useRef, useState } from "react";
import { BID_CHECKS, CAPABILITY_FIELDS, bidReadiness, bidWorksheet, capabilityText, matrixCsv, type BidAnswer, type BidAnswers, type CapabilityInput, type MatrixRow } from "@/lib/marketing/free-tools";
import { marketingEvent } from "@/lib/client/marketing-event";

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  marketingEvent("resource_download", { location: "content" });
}
/** One completed use per visit or explicit reset, without sending entered values. */
function useToolCompletion() {
  const completed = useRef(false);
  return {
    record() {
      if (completed.current) return;
      completed.current = true;
      marketingEvent("tool_completed", { location: "content" });
    },
    reset() { completed.current = false; },
  };
}
export function BidScorecard() {
  const [answers, setAnswers] = useState<BidAnswers>({});
  const completion = useToolCompletion();
  const result = bidReadiness(answers);
  function answerCheck(id: typeof BID_CHECKS[number]["id"], answer: BidAnswer) {
    const next = { ...answers, [id]: answer };
    setAnswers(next);
    if (bidReadiness(next).unanswered === 0) completion.record();
  }
  return <div className="bco-tool-grid">
    <div>{BID_CHECKS.map((check, i) => <fieldset className="bco-tool-question" key={check.id}>
      <legend>{i + 1}. {check.label}</legend><p>{check.help}</p>
      <div className="bco-tool-options">{(["yes", "no", "unknown"] as BidAnswer[]).map(answer => <label key={answer}>
        <input type="radio" name={check.id} checked={answers[check.id] === answer} onChange={() => answerCheck(check.id, answer)} />
        {answer === "unknown" ? "Need to verify" : answer === "yes" ? "Yes" : "No"}
      </label>)}</div>
    </fieldset>)}</div>
    <aside className="bco-tool-result" aria-live="polite" aria-atomic="true">
      <p className="bco-kicker">Your review</p><h2>{result.status}</h2>
      <p className="bco-tool-number">{result.confirmed}<span> / {result.total}</span></p><p>checks confirmed</p>
      <progress value={result.confirmed} max={result.total} aria-label="Checks confirmed" />
      <p>This measures checklist readiness. It is not a win probability, a compliance certification or a recommendation to bid.</p>
      {result.blockers.length > 0 && <p><strong>A critical requirement is marked No.</strong> Resolve it with the appropriate source before committing.</p>}
      <button className="bco-button" disabled={result.unanswered > 0} onClick={() => download(bidWorksheet(answers), "BrostCo-Bid-Decision.md", "text/markdown;charset=utf-8")}>Download your worksheet</button>
      {result.unanswered > 0 && <p className="bco-caption">Answer all seven checks to download. “Need to verify” is a valid answer.</p>}
      <button className="bco-text-link" onClick={() => { setAnswers({}); completion.reset(); }}>Clear answers</button>
    </aside>
  </div>;
}
const EMPTY_CAPABILITY: CapabilityInput = { company: "", summary: "", competencies: "", differentiators: "", experience: "", identifiers: "", contact: "" };
export function CapabilityBuilder() {
  const [values, setValues] = useState<CapabilityInput>(EMPTY_CAPABILITY);
  const [ready, setReady] = useState(false);
  const completion = useToolCompletion();
  return <div className="bco-tool-grid"><form onSubmit={e => { e.preventDefault(); setReady(true); completion.record(); }}>
    {CAPABILITY_FIELDS.map(field => <label className="bco-tool-field" key={field.key} htmlFor={`cap-${field.key}`}>{field.label}{field.required ? " *" : ""}<textarea id={`cap-${field.key}`} required={field.required} rows={field.key === "company" ? 1 : 3} maxLength={2000} placeholder={field.placeholder} value={values[field.key]} onChange={e => { setReady(false); setValues(old => ({ ...old, [field.key]: e.target.value })); }} /></label>)}
    <button className="bco-button" type="submit">Prepare statement</button>
    <button className="bco-text-link" type="button" onClick={() => { setValues(EMPTY_CAPABILITY); setReady(false); completion.reset(); }}>Clear all fields</button>
  </form><aside className="bco-tool-result" aria-live="polite"><p className="bco-kicker">Your statement</p><h2>{ready ? values.company : "Your capabilities, clearly organized."}</h2>
    {ready ? <><pre className="bco-tool-preview">{capabilityText(values)}</pre><button className="bco-button" onClick={() => download(capabilityText(values), "BrostCo-Capability-Statement.md", "text/markdown;charset=utf-8")}>Download editable statement</button></> : <p>Complete the required fields to create an editable document. This builder uses only what you enter and does not invent experience or certifications.</p>}
    <p className="bco-caption">Your entries stay in this browser tab. Download before leaving, because refreshing clears them. Review the final document before sharing.</p>
  </aside></div>;
}
function blankRow(): MatrixRow { return { requirement: "", source: "", owner: "", response: "", status: "Not reviewed" }; }
export function ComplianceMatrix() {
  const [rows, setRows] = useState<MatrixRow[]>([blankRow()]);
  const completion = useToolCompletion();
  const valid = rows.some(r => r.requirement.trim());
  const filled = rows.filter(r => r.requirement.trim());
  return <div><p>Enter each requirement in the buyer’s words. Record its source and amendment so the reviewer can check it.</p>
    {rows.map((row, i) => <fieldset className="bco-matrix-row" key={i}><legend>Requirement {i + 1}</legend>
      {([['requirement', 'Requirement'], ['source', 'Source, page and amendment'], ['owner', 'Owner'], ['response', 'Response location']] as const).map(([key, label]) => <label className="bco-tool-field" key={key}>{label}<textarea rows={key === "requirement" ? 2 : 1} maxLength={2000} value={row[key]} onChange={e => setRows(old => old.map((r, n) => n === i ? { ...r, [key]: e.target.value } : r))} /></label>)}
      <label className="bco-tool-field">Review status<select value={row.status} onChange={e => setRows(old => old.map((r, n) => n === i ? { ...r, status: e.target.value } : r))}>{["Not reviewed", "Needs clarification", "In progress", "Ready for review", "Verified by our team"].map(status => <option key={status}>{status}</option>)}</select></label>
      <button className="bco-text-link" onClick={() => { if (rows.length === 1) completion.reset(); setRows(old => old.length === 1 ? [blankRow()] : old.filter((_, n) => i !== n)); }}>{rows.length === 1 ? "Clear row" : `Remove requirement ${i + 1}`}</button>
    </fieldset>)}
    <div className="bco-actions"><button className="bco-button bco-button-secondary" disabled={rows.length >= 100} onClick={() => setRows(old => [...old, blankRow()])}>Add requirement</button><button className="bco-button" disabled={!valid} onClick={() => { if (!valid) return; download(matrixCsv(filled), "BrostCo-Compliance-Matrix.csv", "text/csv;charset=utf-8"); completion.record(); }}>Download CSV ({filled.length} {filled.length === 1 ? "row" : "rows"})</button></div>
    <p className="bco-caption">Up to 100 rows. Rows without a requirement are excluded from the export. Your entries stay in this tab and clear on refresh. This worksheet does not certify compliance.</p>
  </div>;
}
