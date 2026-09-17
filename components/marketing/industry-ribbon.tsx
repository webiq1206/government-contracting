"use client";

import { INDUSTRIES } from "./industry-content";
import { IndustryIcon } from "./industry-slider";

export function IndustryRibbon() {
  return (
    <div className="bco-industry-ribbon">
      <div className="bco-ribbon-heading bco-container">
        <p>Government opportunities across industries</p>
        <div>
          <a href="#industries">Explore industries <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <div id="industry-sectors" className="bco-ribbon-window bco-container" role="region" tabIndex={0} aria-label="Industry sectors, scroll to browse">
        <div className="bco-ribbon-track bco-continuous-track">
          {[0, 1].map(copy => <ul key={copy} aria-hidden={copy === 1 ? true : undefined}>{INDUSTRIES.map(industry => (
            <li key={industry.name}><IndustryIcon kind={industry.icon} /><span>{industry.name}</span></li>
          ))}</ul>)}
        </div>
      </div>
    </div>
  );
}
