"use client";
import { useEffect, useRef, useState } from "react";

const RESPONSIVE_DEMOS = new Set(["hero-preview", "platform-walkthrough", "pipeline", "review", "subs", "communications", "opportunity", "activity"]);
const MEDIA_REVISION = "2026-09-16-recorded";

/** Native, keyboard-accessible media with an explicit recovery path. No autoplay. */
export function ProductVideo({ slug, poster, title, className = "" }: {
  slug: string; poster: string; title: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mobile, setMobile] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // Choose native phone footage once. Rotating a device must not restart a tour.
  useEffect(() => setMobile(window.matchMedia("(max-width: 640px)").matches), []);
  useEffect(() => { setFailed(false); }, [slug]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Leave untouched players idle. Calling pause() on an empty media element
    // can start resource selection and show a loading state before Play.
    const pause = () => { if (!element.paused) element.pause(); };
    const onVisibility = () => { if (document.hidden) pause(); };
    const onOtherPlayback = (event: Event) => {
      if ((event as CustomEvent).detail !== element) pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) pause();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("brostco:product-play", onOtherPlayback);
    return () => {
      pause();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("brostco:product-play", onOtherPlayback);
    };
  }, [slug, attempt, mobile]);
  const responsive = RESPONSIVE_DEMOS.has(slug);
  const format = responsive && mobile ? "mobile" : "desktop";
  const source = `/demos/${slug}${format === "mobile" ? "-mobile" : ""}.mp4?v=${MEDIA_REVISION}`;
  const currentPoster = responsive ? `/demos/${slug}-${format}.jpg?v=${MEDIA_REVISION}` : poster;
  return <div className="bco-product-video">
    <video ref={video} key={`${slug}-${attempt}-${format}`} className={className} controls playsInline preload="none"
      data-product-video data-responsive={responsive} data-format={format} width={format === "mobile" ? 720 : 1600} height={format === "mobile" ? 1600 : 1000}
      poster={currentPoster} aria-label={title} onError={() => setFailed(true)}
      onPlay={(event) => document.dispatchEvent(new CustomEvent("brostco:product-play", { detail: event.currentTarget }))}>
      <source src={source} type="video/mp4" onError={() => setFailed(true)} />
      <track kind="captions" src={`/demos/${slug}.vtt?v=${MEDIA_REVISION}`} srcLang="en" label="English" default />
      Your browser cannot play this video. <a href={`/demos/${slug}.txt`}>Read the transcript</a>.
    </video>
    {failed && <div role="alert" className="bco-video-error">
      <p>The video could not load. You can try again or read the same walkthrough below.</p>
      <div className="bco-actions">
        <button type="button" className="bco-button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try video again</button>
        <a className="bco-text-link" href={`/demos/${slug}.txt`}>Read transcript</a>
      </div>
    </div>}
  </div>;
}
