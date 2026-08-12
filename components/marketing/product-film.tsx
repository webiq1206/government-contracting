"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export function ProductFilm() {
  const labelId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    const video = videoRef.current;
    if (!el || !video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.4, 0.7] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function onKey(e: KeyboardEvent<HTMLVideoElement>) {
    if (e.key === " " || e.key === "k" || e.key === "K" || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  }

  return (
    <div ref={rootRef} className="film" id="see-it" role="region" aria-labelledby={labelId}>
      <div className="film-intro">
        <p className="eyebrow light">
          <i />
          Product film
        </p>
        <h2 id={labelId}>See the real Brost Co workflow</h2>
        <p>
          One minute on the Brost Co dashboard: SAM.gov intake through package prep.
          You only step in for pursue-or-pass, calls, quotes, and final submission.
          Captions are on the picture, so you do not need sound.
        </p>
      </div>

      <div className="film-stage">
        <video
          ref={videoRef}
          className="film-video"
          poster="/film/poster.jpg"
          playsInline
          muted
          loop
          preload="metadata"
          disablePictureInPicture
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={toggle}
          onKeyDown={onKey}
          tabIndex={0}
          aria-label="Brost Co product film: from SAM.gov intake to submission"
        >
          <source src="/film/workflow.webm" type="video/webm" />
          <source src="/film/workflow.mp4" type="video/mp4" />
        </video>
        <button
          type="button"
          className="film-playmark"
          hidden={playing}
          onClick={toggle}
          aria-label="Play product film, about one minute, captions on the picture"
        >
          <i>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
              <path d="M7 4.5v13l12-6.5L7 4.5Z" fill="currentColor" />
            </svg>
          </i>
          <span>Play · 1 min · Captions on picture</span>
        </button>
        <button
          type="button"
          className={`film-playbtn${playing ? " is-playing" : ""}`}
          onClick={toggle}
          aria-label={playing ? "Pause film" : "Play film"}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}
