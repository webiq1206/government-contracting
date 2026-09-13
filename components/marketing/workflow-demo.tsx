"use client";
import { useId, useRef, useState } from "react";
import { WORKFLOW_STAGES } from "./site-content";

/** A simplified, illustrative workflow. No account data or external actions. */
export function OpportunityPreview({ stage = 2 }: { stage?: number }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceId = useId();
  const [reviewed, setReviewed] = useState(false);
  return (
    <div className="bco-preview">
      <div className="bco-preview-top">
        <span className="bco-preview-mark" aria-hidden="true">
          B
        </span>
        <strong>Opportunity workspace</strong>
        <span className="bco-sample">Illustrative sample</span>
      </div>
      <div className="bco-preview-body">
        <div className="bco-preview-heading">
          <div>
            <span className="bco-overline">Federal facilities services</span>
            <h3>Riverside facility maintenance</h3>
          </div>
          <span className="bco-status">
            {stage === 0
              ? "Fit review"
              : stage === 3
                ? "Bid preparation"
                : "In pursuit"}
          </span>
        </div>
        <div className="bco-preview-meta">
          <span>HVAC · Electrical · Grounds</span>
          <span>Sample deadline: Oct 15</span>
        </div>
        <div className="bco-record-path" aria-label="Example pursuit stages">
          {["Opportunity", "Requirements", "Quotes", "Bid review"].map(
            (name, i) => (
              <span
                key={name}
                className={i === Math.min(stage, 3) ? "is-current" : ""}
              >
                {name}
              </span>
            ),
          )}
        </div>
        {stage === 0 && (
          <div className="bco-demo-content">
            <p className="bco-overline">AI fit summary</p>
            <h4>A match for your facilities work.</h4>
            <p>
              The service area and required trades align with this sample
              company profile.
            </p>
            <ul className="bco-check-list">
              <li>Services align with your target work</li>
              <li>Performance location is in your service area</li>
              <li>Review set-aside eligibility before pursuing</li>
            </ul>
          </div>
        )}
        {stage === 1 && (
          <div className="bco-demo-content">
            <p className="bco-overline">AI requirement brief</p>
            <h4>Three trades. One shared scope.</h4>
            <div className="bco-demo-row">
              <strong>HVAC</strong>
              <span>Preventive maintenance & callouts</span>
            </div>
            <div className="bco-demo-row">
              <strong>Electrical</strong>
              <span>Inspection & repair coverage</span>
            </div>
            <div className="bco-demo-row">
              <strong>Grounds</strong>
              <span>Seasonal service schedule</span>
            </div>
            <p className="bco-caption">
              AI extracts the brief. Your team checks the solicitation.
            </p>
          </div>
        )}
        {stage === 2 && (
          <div className="bco-demo-content">
            <div className="bco-demo-label">
              <p className="bco-overline">Subcontractor coverage</p>
              <span>2 of 3 quotes received</span>
            </div>
            <div className="bco-demo-row">
              <div className="bco-vendor">
                <span>H</span>
                <strong>
                  HVAC partner<small>Quote attached</small>
                </strong>
              </div>
              <span className="bco-status">Received</span>
            </div>
            <div className="bco-demo-row">
              <div className="bco-vendor">
                <span>E</span>
                <strong>
                  Electrical partner<small>Quote attached</small>
                </strong>
              </div>
              <span className="bco-status">Received</span>
            </div>
            <div className="bco-demo-row">
              <div className="bco-vendor">
                <span>G</span>
                <strong>
                  Grounds partner<small>Scope clarification needed</small>
                </strong>
              </div>
              <span className="bco-status bco-status-review">Needs you</span>
            </div>
          </div>
        )}
        {stage === 3 && (
          <div className="bco-demo-content">
            <p className="bco-overline">Bid readiness</p>
            <h4>The gap is visible before review.</h4>
            <ul className="bco-check-list">
              <li>Scope and requirement brief attached</li>
              <li>Two trade quotes captured</li>
              <li>Draft pricing and documents in one record</li>
            </ul>
            <div className="bco-demo-notice">
              <strong>Still needed</strong>
              <p>
                Grounds quote, pricing confirmation, and final document review.
              </p>
            </div>
          </div>
        )}
        {stage === 4 && (
          <div className="bco-demo-content">
            <p className="bco-overline">Today / Next action</p>
            <h4>Clarify the grounds scope.</h4>
            <p>
              The subcontractor replied with a question. Review the source,
              confirm the scope, and continue the conversation.
            </p>
            <div className="bco-demo-notice">
              <strong>Activity attached</strong>
              <p>
                Request prepared → Email sent → Reply received → Human review
              </p>
            </div>
            <button
              className="bco-demo-action"
              type="button"
              onClick={() => setReviewed(!reviewed)}
            >
              {reviewed
                ? "Reset sample review"
                : "Try marking the sample reviewed"}
            </button>
            {reviewed && (
              <p role="status" className="bco-caption">
                Sample marked reviewed. No live record was changed.
              </p>
            )}
          </div>
        )}
        <div className="bco-ai-note">
          <span aria-hidden="true">✧</span>
          <div>
            <strong>
              {stage === 2
                ? "AI surfaces the missing piece."
                : "The reasoning stays with the work."}
            </strong>
            <p>
              {stage === 2
                ? "A reply needs scope clarification before the final quote. Your team has the context to act."
                : "Open the supporting information before making the next decision."}
            </p>
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
              Include a separate price for each service.”
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
  const [selected, setSelected] = useState(initialStage);
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
            {String(selected + 1).padStart(2, "0")} / From opportunity to action
          </p>
          <h3>{item.title}</h3>
          <p>{item.copy}</p>
          <div className="bco-benefit">
            <strong>What this gives you</strong>
            <p>{item.benefit}</p>
          </div>
          <p className="bco-caption">
            <strong>Your part:</strong> {item.human}
          </p>
        </div>
        <OpportunityPreview key={selected} stage={selected} />
      </div>
      <p className="bco-caption bco-demo-disclosure">
        Interactive illustration with sample data. Explore the steps at your own
        pace. Actual product recordings are available in the{" "}
        <a href="/demo#recordings">product tour</a>.
      </p>
    </div>
  );
}
