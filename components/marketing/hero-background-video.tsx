"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** Continuous decorative playback while visible, with still-image fallbacks. */
export function HeroBackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    // Select once before mounting the video, avoiding a second download on rotation.
    setMobile(window.matchMedia("(max-width: 640px)").matches);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & {
        connection?: {
          saveData?: boolean;
          addEventListener?: (name: string, listener: () => void) => void;
          removeEventListener?: (name: string, listener: () => void) => void;
        };
      }
    ).connection;
    const sync = () => {
      const enabled = !window.matchMedia("(max-width: 640px)").matches && !media.matches && !connection?.saveData;
      setAllowed(enabled);
      if (!enabled) setPlaying(false);
    };
    sync();
    media.addEventListener("change", sync);
    connection?.addEventListener?.("change", sync);
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (container.current) observer.observe(container.current);
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      media.removeEventListener("change", sync);
      connection?.removeEventListener?.("change", sync);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!allowed || failed || !visible || !pageVisible) {
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
  }, [allowed, failed, visible, pageVisible]);

  return (
    <>
      <div ref={container} className="bco-hero-backdrop" aria-hidden="true">
        <Image
          src="/marketing/hero-poster-full.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
        />
        {allowed && !failed && (
          <video
            ref={ref}
            className={`bco-hero-background-film${playing ? " is-playing" : ""}`}
            data-format={mobile ? "mobile" : "desktop"}
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
            tabIndex={-1}
            aria-hidden="true"
            onPlaying={() => {
              setPlaying(true);
            }}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          >
            <source
              src={`/marketing/hero-background${mobile ? "-mobile" : ""}.mp4?v=20260916-full`}
              type="video/mp4"
              onError={() => {
                setFailed(true);
                setPlaying(false);
              }}
            />
          </video>
        )}
      </div>
    </>
  );
}
