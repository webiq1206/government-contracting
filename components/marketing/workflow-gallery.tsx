"use client";
import { ProductVideo } from "./product-video";
import { useId, useRef, useState } from "react";
const workflows = [
  {
    id: "opportunities",
    label: "Find opportunities",
    title: "Find the work worth pursuing.",
    copy: "Review fit, deadlines, and the next action in a clear opportunity pipeline. Open a record for the details behind the decision.",
    file: "pipeline",
    points: [
      "Company fit and deadlines",
      "A connected pursuit record",
      "Clear status and next steps",
    ],
  },
  {
    id: "review",
    label: "Make decisions",
    title: "The context to make your call.",
    copy: "Work through decisions with the opportunity and its supporting information together. Pursue, pass, or open the evidence before you act.",
    file: "review",
    points: [
      "One decision at a time",
      "Supporting information nearby",
      "Your team keeps judgment",
    ],
  },
  {
    id: "relationships",
    label: "Build your team",
    title: "Keep the people and the pursuit together.",
    copy: "Find subcontractors, inspect their details, and keep the next conversation connected to the work it supports.",
    file: "subs",
    points: [
      "A searchable subcontractor roster",
      "Contact and qualification details",
      "Connected outreach and calls",
    ],
  },
  {
    id: "bid",
    label: "Prepare the bid",
    title: "Know what is ready. See what is missing.",
    copy: "Keep requirements, pricing, documents, and activity with the opportunity. Review the work before your team submits it.",
    file: "opportunity",
    points: [
      "Requirements and source documents",
      "Pricing and preparation in context",
      "Final review stays with you",
    ],
  },
  {
    id: "activity",
    label: "Track the work",
    title: "Understand what happened.",
    copy: "Follow recorded actions, messages, and results. Open the details when you need to see the recipient, output, or next step.",
    file: "activity",
    points: [
      "A readable action history",
      "Search and focused filters",
      "The detail behind each result",
    ],
  },
];
export function WorkflowGallery() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const item = workflows[selected];
  return (
    <div className="bco-gallery">
      <div
        role="tablist"
        aria-label="Explore BrostCo workflows"
        className="bco-gallery-tabs"
        onKeyDown={(event) => {
          let next = selected;
          if (event.key === "ArrowRight")
            next = (selected + 1) % workflows.length;
          else if (event.key === "ArrowLeft")
            next = (selected - 1 + workflows.length) % workflows.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = workflows.length - 1;
          else return;
          event.preventDefault();
          setSelected(next);
          buttons.current[next]?.focus();
        }}
      >
        {workflows.map((workflow, index) => (
          <button
            key={workflow.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            id={`${id}-${workflow.id}`}
            role="tab"
            aria-selected={selected === index}
            aria-controls={`${id}-panel`}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
          >
            {workflow.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${item.id}`}
        className="bco-gallery-panel"
      >
        <div className="bco-gallery-copy">
          <span className="bco-kicker">
            {String(selected + 1).padStart(2, "0")} / The workflow
          </span>
          <h3>{item.title}</h3>
          <p>{item.copy}</p>
          <ul>
            {item.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div className="bco-gallery-media">
          <ProductVideo key={item.file} slug={item.file} poster={`/demos/${item.file}-desktop.jpg`} title={`${item.label}: product walkthrough using sample data`} />
          <p className="bco-caption">
            Guided screen preview · Sample data.{" "}
            <a href={`/demos/${item.file}.txt`}>Read transcript</a>
          </p>
        </div>
      </div>
    </div>
  );
}
