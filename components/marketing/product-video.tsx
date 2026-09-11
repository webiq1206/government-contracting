"use client";
import { useState } from "react";

/** Native, keyboard-accessible media with an explicit recovery path. No autoplay. */
export function ProductVideo({ slug, poster, title, className = "" }: {
  slug: string; poster: string; title: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <div className="bco-product-video">
    <video key={`${slug}-${attempt}`} className={className} controls playsInline preload="none"
      poster={poster} aria-label={title} onError={() => setFailed(true)}>
      <source src={`/demos/${slug}.mp4`} type="video/mp4" />
      <track kind="captions" src={`/demos/${slug}.vtt`} srcLang="en" label="English" default />
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
