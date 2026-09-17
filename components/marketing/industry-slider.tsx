"use client";

import { useId, useState } from "react";
import { INDUSTRIES } from "./industry-content";

export function IndustryIcon({ kind }: { kind: (typeof INDUSTRIES)[number]["icon"] }) {
  const paths = {
    build: "m14 5 5 5M3 21l9-9M10 3l4 2 5 5 2 4-4 1-8-8Z",
    building: "M4 21V3h12v18M16 10h4v11M8 7h4M8 11h4M8 15h4M2 21h20",
    screen: "M3 4h18v13H3ZM8 21h8M12 17v4M9 8l-3 3 3 3M15 8l3 3-3 3",
    briefcase: "M3 7h18v14H3ZM8 7V3h8v4M3 12l9 3 9-3M10 14h4",
    truck: "M2 5h12v13H2ZM14 10h4l4 5v3h-8M6 18v3M18 18v3M18 10v5h4",
    health: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z",
    book: "M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16",
    box: "m12 2 10 5v10l-10 5-10-5V7ZM2 7l10 5 10-5M12 12v10M7 4.5l10 5v5",
    bolt: "m13 2-9 12h7l-1 8 10-13h-8Z",
    leaf: "M20 3C9 1 2 8 6 15s16 1 14-12ZM3 22 15 9",
    spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

export function IndustrySlider() {
  const id = useId();
  const [query, setQuery] = useState("");

  const matches = INDUSTRIES.filter((industry) =>
    `${industry.name} ${industry.examples} ${industry.codes.join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <section
      id="industries"
      className="bco-industries"
      aria-labelledby={`${id}-title`}
    >
      <div className="bco-container">
        <div className="bco-industry-header">
          <div>
            <p className="bco-kicker">Your expertise. Your opportunities.</p>
            <h2 id={`${id}-title`}>
              Federal work spans industries. So does discovery.
            </h2>
          </div>
        </div>
        <div className="bco-industry-window" tabIndex={0} role="region" aria-label="Industry categories">
          <div className="bco-industry-loop bco-continuous-track">
            {[0, 1].map(copy => (
              <ul key={copy} className="bco-industry-track" aria-hidden={copy === 1 ? true : undefined}>
                {INDUSTRIES.map(industry => (
                  <li key={industry.name} className="bco-industry-card">
                    <IndustryIcon kind={industry.icon} />
                    <h3>{industry.name}</h3>
                    <p>{industry.examples}</p>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
        <div className="bco-industry-footer">
          <p>
            Matching follows your services, location, qualifications, and
            industry codes.
          </p>
          <span>
            {INDUSTRIES.length} industry sectors{" "}
            <span aria-hidden="true">·</span> Explore the directory below
          </span>
        </div>
        <details className="bco-industry-directory">
          <summary>
            View all industries <span aria-hidden="true">+</span>
          </summary>
          <div className="bco-industry-directory-body">
            <label htmlFor={`${id}-search`}>
              Find your industry or service
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try HVAC, software, healthcare, or logistics"
            />
            <p className="bco-caption" role="status">
              {matches.length} of {INDUSTRIES.length} sectors
            </p>
            <ul>
              {matches.map((industry) => (
                <li key={industry.name}>
                  <strong>{industry.name}</strong>
                  <p>{industry.examples}</p>
                  <span>Industry codes: {industry.codes.join(", ")}</span>
                </li>
              ))}
            </ul>
            {matches.length === 0 && (
              <p>
                No matching sector. Try a broader service name or{" "}
                <button
                  type="button"
                  className="bco-text-link"
                  onClick={() => setQuery("")}
                >
                  show all industries
                </button>
                .
              </p>
            )}
            <p className="bco-caption">
              These broad sectors cover the industry catalog in Company Profile.
              Choose your specific codes during setup. Opportunity availability
              and workflow fit depend on your business and the solicitation.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
