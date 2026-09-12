"use client";

import { useEffect, useRef, useState } from "react";

/** Decorative product-motion layer for the public hero.
 * The copy and CTA never depend on playback. Reduced-motion users and failed
 * playback get the poster image instead.
 */
export function HeroBackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduced || failed) return;
    const video = ref.current;
    if (!video) return;
    const promise = video.play();
    promise?.catch(() => setFailed(true));
  }, [reduced, failed]);

  if (reduced || failed) {
    return (
      <div
        className="bco-hero-media bco-hero-poster"
        role="img"
        aria-label="BrostCo opportunity workflow preview"
      />
    );
  }

  return (
    <video
      ref={ref}
      className="bco-hero-media"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster="/demos/today-desktop.jpg"
      aria-hidden="true"
      tabIndex={-1}
      onError={() => setFailed(true)}
    >
      <source src="/demos/hero-loop.mp4" type="video/mp4" />
      <source src="/demos/hero-preview.mp4" type="video/mp4" />
    </video>
  );
}
