"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/wordmark";
import { CtaArrow } from "./cta-arrow";

/**
 * Sections that already put a primary CTA in front of the visitor (or that the
 * bar would otherwise cover). While any of these is on screen the sticky bar
 * steps out of the way, so the page never shows two competing trial buttons.
 */
const SUPPRESS_SELECTORS = ["#pricing", ".final-cta", ".mkt-lp footer"] as const;

export interface LandingStickyCtaProps {
  /** Signup destination — same href as the hero and pricing CTAs. */
  href: string;
  /** Button label, e.g. "Start 7-day free trial". */
  label: string;
  /** What happens after the trial, e.g. "$149/mo after your free trial". */
  priceNote: string;
  /** Short reassurance, rendered as a mono label. */
  subNote: string;
}

/**
 * Persistent trial CTA for the marketing landing page.
 *
 * Appears once the hero (and its CTA) has scrolled away, and hides again over
 * the pricing / final-CTA / footer block. Renders as a pinned top bar on
 * desktop and a thumb-reachable bottom bar on phones — see `.sticky-cta` in
 * landing.css.
 */
export function LandingStickyCta({ href, label, priceNote, subNote }: LandingStickyCtaProps) {
  const [pastHero, setPastHero] = useState(false);
  const [suppressed, setSuppressed] = useState(false);

  // Show the bar only after the hero — and its own CTA — is off screen.
  useEffect(() => {
    const hero = document.getElementById("top");
    if (!hero) return;

    const io = new IntersectionObserver(
      ([entry]) => setPastHero(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  // Step aside for sections that carry their own CTA.
  useEffect(() => {
    const nodes = SUPPRESS_SELECTORS.flatMap((sel) =>
      Array.from(document.querySelectorAll(sel)),
    );
    if (nodes.length === 0) return;

    const onScreen = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(entry.target);
          else onScreen.delete(entry.target);
        }
        setSuppressed(onScreen.size > 0);
      },
      { threshold: 0 },
    );
    nodes.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, []);

  const visible = pastHero && !suppressed;

  return (
    <div
      className={`sticky-cta${visible ? " is-visible" : ""}`}
      aria-hidden={!visible}
    >
      <div className="sticky-cta-inner">
        <Link
          className="sticky-cta-logo"
          href="#top"
          aria-label="Back to top"
          tabIndex={visible ? undefined : -1}
        >
          <Wordmark variant="light" className="h-5" />
        </Link>
        <span className="sticky-cta-rule" aria-hidden="true" />
        <div className="sticky-cta-copy">
          <b>{priceNote}</b>
          <span>{subNote}</span>
        </div>
        <Link
          className="btn btn-small sticky-cta-btn"
          href={href}
          tabIndex={visible ? undefined : -1}
        >
          {label} <CtaArrow />
        </Link>
      </div>
    </div>
  );
}
