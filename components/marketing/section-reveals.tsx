"use client";

import { useEffect } from "react";

/** Content is visible by default, including without JS or animation support. */
export function SectionReveals() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        observer.unobserve(target);
        if (media.matches || !target.animate) return;
        const animation = target.animate([
          { opacity: .65, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 320, easing: "cubic-bezier(.2,.7,.3,1)" });
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      });
    }, { threshold: .12 });
    document.querySelectorAll('.bco-site .bco-card, .bco-site .bco-section-heading > h2, .bco-site .bco-chapter-copy > h2')
      .forEach(element => observer.observe(element));
    const stop = () => { if (media.matches) animations.forEach(animation => animation.cancel()); };
    media.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      animations.forEach(animation => animation.cancel());
      media.removeEventListener("change", stop);
    };
  }, []);
  return null;
}
