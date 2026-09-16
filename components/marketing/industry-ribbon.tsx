"use client";

import { useEffect, useRef, useState } from "react";
import { INDUSTRIES } from "./industry-content";
import { IndustryIcon } from "./industry-slider";

/** Industry coverage, never customer logos or implied endorsements. */
export function IndustryRibbon() {
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const ribbon = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!motion.matches);
    const onMotion = () => { if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", onMotion);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ribbon.current) observer.observe(ribbon.current);
    const onVisibility = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return (
    <div className="bco-industry-ribbon" ref={ribbon} aria-label="Industries covered by opportunity discovery">
      <div className="bco-ribbon-heading bco-container">
        <p>Government opportunities across industries</p>
        <div>
          <a href="#industries">Explore industries <span aria-hidden="true">↗</span></a>
          <button type="button" aria-label={playing ? "Pause industry ribbon" : "Play industry ribbon"}
            aria-pressed={playing} onClick={() => setPlaying(!playing)}>
            <span aria-hidden="true">{playing ? "Ⅱ" : "▷"}</span>
          </button>
        </div>
      </div>
      <div className="bco-ribbon-window">
        <div className="bco-ribbon-track" data-playing={playing && visible}>
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 ? true : undefined}>
              {INDUSTRIES.map((industry) => (
                <li key={industry.name}><IndustryIcon kind={industry.icon} /><span>{industry.name}</span></li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}
