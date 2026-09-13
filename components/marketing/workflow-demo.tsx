"use client";
import { useId, useRef, useState } from "react";
import { WORKFLOW_STAGES } from "./site-content";

/** A simplified, illustrative workflow. No account data or external actions. */
export function OpportunityPreview({ stage = 3 }: { stage?: number }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceId = useId();
  const [reviewed, setReviewed] = useState(false);
  const current = Math.max(0, Math.min(WORKFLOW_STAGES.length - 1, stage));
  const item = WORKFLOW_STAGES[current];
  return (
    <div className="bco-preview">
      <div className="bco-preview-top">
        <span className="bco-preview-mark" aria-hidden="true">
          B
        </span>
        <strong>
          {current === 4
            ? "Today / Your next actions"
            : "Opportunity workspace"}
        </strong>
        <span className="bco-sample">Illustrative sample</span>
      </div>
      <div className="bco-preview-body">
        <div className="bco-preview-heading">
          <div>
            <span className="bco-overline">Federal facilities services</span>
            <h3>Riverside facility maintenance</h3>
          </div>
        </div>
        <div className="bco-preview-meta">
          <span>HVAC · Electrical · Grounds</span>
          <span>Sample deadline: Oct 15</span>
        </div>
        <ol className="bco-record-path" aria-label="Example pursuit progress">
          {WORKFLOW_STAGES.map((step, i) => (
            <li
              key={step.label}
              className={
                i === current ? "is-current" : i < current ? "is-done" : ""
              }
              aria-current={i === current ? "step" : undefined}
            >
              <span aria-hidden="true">{i < current ? "✓ " : ""}</span>
              {step.label}
            </li>
          ))}
        </ol>
        <div className="bco-demo-completed">
          <span aria-hidden="true">✓</span>
          <strong>{item.done}</strong>
        </div>
        <div className="bco-demo-content">
          {current === 0 && (
            <>
              <p className="bco-overline">AI match explanation</p>
              <h4>A strong fit, ready for analysis.</h4>
              <div className="bco-demo-row">
                <strong>Your services</strong>
                <span>HVAC, electrical, grounds match</span>
              </div>
              <div className="bco-demo-row">
                <strong>Your location</strong>
                <span>Inside your service area</span>
              </div>
              <div className="bco-demo-row">
                <strong>Your rules</strong>
                <span>Pursue threshold met</span>
              </div>
              <p className="bco-caption">
                Next: analysis starts under the sample company rules.
              </p>
            </>
          )}
          {current === 1 && (
            <>
              <p className="bco-overline">
                Extracted from the sample solicitation
              </p>
              <h4>The brief is already written.</h4>
              <div className="bco-demo-row">
                <strong>Scope</strong>
                <span>HVAC, electrical & grounds maintenance</span>
              </div>
              <div className="bco-demo-row">
                <strong>Due date</strong>
                <span>October 15</span>
              </div>
              <div className="bco-demo-row">
                <strong>Pricing needed</strong>
                <span>A separate price for each trade</span>
              </div>
              <p className="bco-caption">
                Next: the extracted trades guide subcontractor discovery.
              </p>
            </>
          )}
          {current === 2 && (
            <>
              <p className="bco-overline">AI outreach activity</p>
              <h4>Requests sent. Replies connected.</h4>
              <div className="bco-demo-row">
                <div className="bco-vendor">
                  <span aria-hidden="true">H</span>
                  <strong>
                    HVAC<small>Request sent → price captured from reply</small>
                  </strong>
                </div>
                <span className="bco-status">Quote received</span>
              </div>
              <div className="bco-demo-row">
                <div className="bco-vendor">
                  <span aria-hidden="true">E</span>
                  <strong>
                    Electrical
                    <small>Request sent → price captured from reply</small>
                  </strong>
                </div>
                <span className="bco-status">Quote received</span>
              </div>
              <div className="bco-demo-row">
                <div className="bco-vendor">
                  <span aria-hidden="true">G</span>
                  <strong>
                    Grounds
                    <small>Follow-up sent → price captured from reply</small>
                  </strong>
                </div>
                <span className="bco-status">Quote received</span>
              </div>
              <p className="bco-caption">
                3 of 3 quote replies received in this example. Your team
                confirms the prices.
              </p>
            </>
          )}
          {current === 3 && (
            <>
              <p className="bco-overline">
                Prepared by AI / Ready for your checks
              </p>
              <h4>Your draft bid is assembled.</h4>
              <div className="bco-demo-row">
                <div className="bco-vendor">
                  <span aria-hidden="true">▤</span>
                  <strong>
                    Bid narrative
                    <small>Scope and company context included</small>
                  </strong>
                </div>
                <span className="bco-file-type">DOCX</span>
              </div>
              <div className="bco-demo-row">
                <div className="bco-vendor">
                  <span aria-hidden="true">▤</span>
                  <strong>
                    Pricing summary
                    <small>Trade quotes + your margin rules</small>
                  </strong>
                </div>
                <span className="bco-file-type">PDF</span>
              </div>
              <div className="bco-demo-row">
                <div className="bco-vendor">
                  <span aria-hidden="true">✓</span>
                  <strong>
                    Requirement checklist
                    <small>Review points and sources attached</small>
                  </strong>
                </div>
                <span className="bco-file-type">CHECKLIST</span>
              </div>
              <p className="bco-caption">
                Next: your team checks pricing, documents, and contract terms.
              </p>
            </>
          )}
          {current === 4 && (
            <>
              <p className="bco-overline">AI completed</p>
              <p className="bco-completed-summary">
                Discovery, analysis, outreach, follow-ups, and draft
                preparation.
              </p>
              <div className="bco-human-queue">
                <div className="bco-demo-label">
                  <strong>Needs your judgment</strong>
                  <span>{reviewed ? "1 action" : "2 actions"}</span>
                </div>
                <div className="bco-demo-row">
                  <div>
                    <strong>Call to confirm site access</strong>
                    <small>Contact, background, and questions prepared</small>
                  </div>
                  <span className="bco-status bco-status-review">Call</span>
                </div>
                <div className="bco-demo-row">
                  <div>
                    <strong>Review the bid and contract terms</strong>
                    <small>Draft documents and pricing attached</small>
                  </div>
                  <span
                    className={`bco-status${reviewed ? "" : " bco-status-review"}`}
                  >
                    {reviewed ? "Reviewed" : "Review"}
                  </span>
                </div>
              </div>
              <button
                className="bco-demo-action"
                type="button"
                onClick={() => setReviewed(!reviewed)}
              >
                {reviewed
                  ? "Reset sample review"
                  : "Try marking the sample reviewed"}
                <span aria-hidden="true">↗</span>
              </button>
              {reviewed && (
                <p role="status" className="bco-caption">
                  Sample marked reviewed. No live record was changed.
                </p>
              )}
            </>
          )}
        </div>
        <div className="bco-ai-note">
          <span aria-hidden="true">✧</span>
          <div>
            <strong>{item.result}</strong>
            <p>{item.evidence}</p>
          </div>
        </div>
        <button
          type="button"
          className="bco-demo-action"
          aria-expanded={sourceOpen}
          aria-controls={sourceId}
          onClick={() => setSourceOpen(!sourceOpen)}
        >
          {sourceOpen ? "Close sample source" : "Open sample source"}
          <span aria-hidden="true">↗</span>
        </button>
        {sourceOpen && (
          <div id={sourceId} className="bco-demo-source">
            <p className="bco-overline">Illustrative source / Scope excerpt</p>
            <blockquote>
              “Provide scheduled HVAC, electrical, and grounds maintenance.
              Include a separate price for each service. Responses are due
              October 15.”
            </blockquote>
            <p>
              This example explains the workflow. It is not an actual
              solicitation or a live AI result.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkflowDemo({ initialStage = 0 }: { initialStage?: number }) {
  const [selected, setSelected] = useState(
    Math.max(0, Math.min(WORKFLOW_STAGES.length - 1, initialStage)),
  );
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const item = WORKFLOW_STAGES[selected];
  return (
    <div className="bco-workflow-demo">
      <div
        className="bco-demo-tabs"
        role="tablist"
        aria-label="Explore the opportunity workflow"
        onKeyDown={(event) => {
          let next = selected;
          if (event.key === "ArrowRight")
            next = (selected + 1) % WORKFLOW_STAGES.length;
          else if (event.key === "ArrowLeft")
            next =
              (selected + WORKFLOW_STAGES.length - 1) % WORKFLOW_STAGES.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = WORKFLOW_STAGES.length - 1;
          else return;
          event.preventDefault();
          setSelected(next);
          tabs.current[next]?.focus();
        }}
      >
        {WORKFLOW_STAGES.map((stage, i) => (
          <button
            type="button"
            key={stage.label}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={selected === i}
            aria-controls={`${id}-panel`}
            tabIndex={selected === i ? 0 : -1}
            onClick={() => setSelected(i)}
          >
            <span>{i + 1}</span>
            {stage.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        tabIndex={0}
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${selected}`}
        className="bco-demo-panel"
      >
        <div className="bco-demo-explanation">
          <p className="bco-kicker">
            {String(selected + 1).padStart(2, "0")} /{" "}
            {selected === 4 ? "Your focused action list" : "AI at work"}
          </p>
          <h3>{item.title}</h3>
          <p>{item.copy}</p>
          <div className="bco-benefit">
            <span aria-hidden="true">✓</span>
            <p>{item.benefit}</p>
          </div>
          <div className="bco-human-role">
            <strong>Where you come in</strong>
            <p>{item.human}</p>
          </div>
        </div>
        <OpportunityPreview key={selected} stage={selected} />
      </div>
      <div className="bco-demo-footer">
        <p className="bco-caption">
          Interactive illustration with sample data. Automation uses your
          connected services and rules. See actual recordings in the{" "}
          <a href="/demo#recordings">product tour</a>.
        </p>
        <button
          type="button"
          className="bco-text-link"
          onClick={() => {
            const next = (selected + 1) % WORKFLOW_STAGES.length;
            setSelected(next);
            tabs.current[next]?.focus();
          }}
        >
          {selected === WORKFLOW_STAGES.length - 1
            ? "Back to discovery"
            : "See the next step"}{" "}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
