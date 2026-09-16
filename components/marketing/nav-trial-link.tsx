"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function NavTrialLink({ href }: { href: string }) {
  const [heroHidden, setHeroHidden] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".bco-hero-centered");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => {
      setHeroHidden(!entry.isIntersecting);
    }, { rootMargin: "-72px 0px 0px" });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);
  return <Link href={href} className="bco-button" data-hero-hidden={heroHidden}>Start free trial</Link>;
}
