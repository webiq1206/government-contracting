"use client";

import { useState } from "react";

export type LandingFaqItem = { q: string; a: string };

/** Exclusive accordion matching the inspiration FAQ behavior. */
export function LandingFaq({ items }: { items: LandingFaqItem[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="faq-list">
      {items.map((item, i) => {
        const n = String(i + 1).padStart(2, "0");
        const isOpen = open === i;
        return (
          <details
            key={item.q}
            open={isOpen}
            onToggle={(e) => {
              const el = e.currentTarget;
              if (el.open) setOpen(i);
              else if (open === i) setOpen(-1);
            }}
          >
            <summary>
              <span>{n}</span>
              <b>{item.q}</b>
              <i>+</i>
            </summary>
            <p>{item.a}</p>
          </details>
        );
      })}
    </div>
  );
}
