"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function NavTrialLink({ href }: { href: string }) {
  const [heroHidden, setHeroHidden] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".bco-hero-centered");
    if (!hero) return;
    const actions = [...document.querySelectorAll<HTMLAnchorElement>('main a.bco-button')]
      .filter(link => link.getAttribute('href') === href);
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      setHeroHidden(visible.size === 0);
    }, { rootMargin: "-80px 0px 0px", threshold: 0 });
    actions.forEach(action => observer.observe(action));
    return () => observer.disconnect();
  }, [href]);
  return <Link href={href} className="bco-button" data-hero-hidden={heroHidden}>Start free trial</Link>;
}
