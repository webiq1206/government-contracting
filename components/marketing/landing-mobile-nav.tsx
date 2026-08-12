"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Full-viewport mobile menu for the marketing landing page.
 * Closes on link tap and locks body scroll while open.
 */
export function LandingMobileNav({
  signupHref,
  loginHref,
}: {
  signupHref: string;
  loginHref: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;

    function syncBody() {
      const open = el?.open ?? false;
      document.body.style.overflow = open ? "hidden" : "";
    }

    syncBody();
    el.addEventListener("toggle", syncBody);
    return () => {
      el.removeEventListener("toggle", syncBody);
      document.body.style.overflow = "";
    };
  }, []);

  function close() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details ref={detailsRef} className="mobile-nav">
      <summary aria-label="Open navigation">
        <i />
        <i />
      </summary>
      <nav aria-label="Mobile navigation">
        <a href="#platform" onClick={close}>
          Platform
        </a>
        <a href="#workflow" onClick={close}>
          How it works
        </a>
        <a href="#pricing" onClick={close}>
          Pricing
        </a>
        <a href="#faq" onClick={close}>
          FAQ
        </a>
        <Link href={loginHref} onClick={close}>
          Log in
        </Link>
        <Link className="mobile-nav-cta" href={signupHref} onClick={close}>
          Start free trial
        </Link>
      </nav>
    </details>
  );
}
