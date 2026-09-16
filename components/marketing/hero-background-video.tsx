"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** User-supplied decorative film. The poster and copy never depend on playback. */
export function HeroBackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [finished, setFinished] = useState(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    const sync = () => {
      const enabled = !media.matches && !connection?.saveData;
      setAllowed(enabled);
      if (!enabled) setPlaying(false);
    };
    sync();
    media.addEventListener("change", sync);
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (container.current) observer.observe(container.current);
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      media.removeEventListener("change", sync);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!allowed || finished || failed || !visible || !pageVisible) {
      video.pause();
      return;
    }
    let active = true;
    video.play()?.catch(() => {
      if (active) {
        setFailed(true);
        setPlaying(false);
      }
    });
    return () => {
      active = false;
      video.pause();
    };
  }, [allowed, finished, failed, visible, pageVisible]);

  return (
    <>
      <div ref={container} className="bco-hero-backdrop" aria-hidden="true">
        <Image
          src="/marketing/hero-poster.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
        />
        {allowed && !failed && !(finished && !playing) && (
          <video
            ref={ref}
            className={`bco-hero-background-film${playing ? " is-playing" : ""}`}
            muted
            playsInline
            preload="none"
            tabIndex={-1}
            aria-hidden="true"
            onPlaying={() => {
              setPlaying(true);
              // A brief decorative introduction, not perpetual unpausable motion.
              // Keep the final frame visible rather than flashing back to a poster.
              if (!stopTimer.current) stopTimer.current = setTimeout(() => setFinished(true), 4000);
            }}
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= 4) setFinished(true);
            }}
            onEnded={() => setFinished(true)}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          >
            <source src="/marketing/hero-background.mp4" type="video/mp4" />
          </video>
        )}
      </div>
    </>
  );
}
