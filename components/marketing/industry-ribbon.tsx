"use client";

import { useRef } from "react";
import { INDUSTRIES } from "./industry-content";
import { IndustryIcon } from "./industry-slider";

/** Manual browsing works with touch, keyboard, or the paging controls. */
export function IndustryRibbon() {
  const track = useRef<HTMLDivElement>(null);
  function move(direction: number) {
    const element = track.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * .75,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return (
    <div className="bco-industry-ribbon">
      <div className="bco-ribbon-heading bco-container">
        <p>Government opportunities across industries</p>
        <div>
          <a href="#industries">Explore industries <span aria-hidden="true">↗</span></a>
          <button type="button" aria-label="Browse earlier industry sectors" aria-controls="industry-sectors" onClick={() => move(-1)}>←</button>
          <button type="button" aria-label="Browse more industry sectors" aria-controls="industry-sectors" onClick={() => move(1)}>→</button>
        </div>
      </div>
      <div ref={track} id="industry-sectors" className="bco-ribbon-window bco-container" role="region" tabIndex={0} aria-label="Industry sectors, scroll to browse">
        <div className="bco-ribbon-track">
          <ul>{INDUSTRIES.map(industry => (
            <li key={industry.name}><IndustryIcon kind={industry.icon} /><span>{industry.name}</span></li>
          ))}</ul>
        </div>
      </div>
    </div>
  );
}
