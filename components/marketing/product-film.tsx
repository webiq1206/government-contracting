"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/**
 * Landing product film.
 *
 * Two encodes exist: a 1080p desktop cut and a much lighter 720p mobile cut.
 * The `media` attribute on <source> is not honoured reliably once a video has
 * loaded, so the source is chosen in an effect and assigned directly instead.
 *
 * Play state is driven by real playback events. `play()` resolving only means
 * playback was permitted, not that pictures are on screen — using it to flip
 * the control to "Pause" is what previously left mobile viewers staring at a
 * still frame under a Pause button while the file was still buffering.
 */

type Status = "idle" | "loading" | "playing" | "paused";

function pickSource(): string {
  // Coarse pointer or narrow viewport gets the light 720p cut; it is the same
  // framing, just cheaper to fetch and decode over a phone radio.
  const small =
    window.matchMedia("(max-width: 820px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;
  return small ? "/film/workflow-mobile.mp4" : "/film/workflow.mp4";
}

export function ProductFilm() {
  const labelId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [reduced, setReduced] = useState(false);

  // Choose and attach the encode once, on the client.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.src) return;
    video.src = pickSource();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Autoplay while in view, but never against a reduced-motion preference.
  useEffect(() => {
    const el = rootRef.current;
    const video = videoRef.current;
    if (!el || !video) return;

    // If the preference flips to reduce mid-playback, stop the motion now
    // rather than only declining to start it next time.
    if (reduced) {
      if (!video.paused) video.pause();
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
          if (video.paused) {
            // If this is refused we simply stay on the poster with the play
            // affordance showing, which is the correct fallback.
            video.play().catch(() => setStatus("idle"));
          }
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: [0, 0.4, 0.7] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setStatus((s) => (s === "playing" ? s : "loading"));
      video.play().catch(() => setStatus("idle"));
    } else {
      video.pause();
    }
  }, []);

  function onKey(e: KeyboardEvent<HTMLVideoElement>) {
    if (e.key === " " || e.key === "k" || e.key === "K" || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  }

  // "playing" fires when frames are actually being presented; "waiting" when
  // the buffer runs dry. Together they keep the label honest.
  const isPlaying = status === "playing";
  const busy = status === "loading";

  return (
    <div ref={rootRef} className="film" id="see-it" role="region" aria-labelledby={labelId}>
      <div className="film-intro">
        <p className="eyebrow light">
          <i />
          Product film
        </p>
        <h2 id={labelId}>See the real Brost Co workflow</h2>
        <p>
          Just under a minute on the Brost Co dashboard: SAM.gov intake through
          submission. Everything marked <b>automatic</b> runs without you. You step in
          only for pursue-or-pass, the calls, the quotes, and the final send. Captions
          are on the picture, so there is nothing to listen to.
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
          onPlaying={() => setStatus("playing")}
          onWaiting={() => setStatus("loading")}
          onPause={() => setStatus("paused")}
          onEnded={() => setStatus("paused")}
          onClick={toggle}
          onKeyDown={onKey}
          tabIndex={0}
          aria-label="Brost Co product film: eleven steps from SAM.gov intake to submission, with captions on the picture"
        />

        <button
          type="button"
          className="film-playmark"
          hidden={isPlaying}
          onClick={toggle}
          aria-label="Play product film, about one minute, captions on the picture"
        >
          <i>
            {busy ? (
              <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
                <circle
                  cx="13"
                  cy="13"
                  r="10"
                  stroke="currentColor"
                  strokeOpacity=".25"
                  strokeWidth="2"
                />
                <path
                  d="M23 13a10 10 0 0 0-10-10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 13 13"
                    to="360 13 13"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                </path>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
                <path d="M7 4.5v13l12-6.5L7 4.5Z" fill="currentColor" />
              </svg>
            )}
          </i>
          <span>{busy ? "Loading film…" : "Play · 1 min · Captions on picture"}</span>
        </button>

        <button
          type="button"
          className={`film-playbtn${isPlaying ? " is-playing" : ""}`}
          onClick={toggle}
          aria-label={isPlaying ? "Pause film" : "Play film"}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}
