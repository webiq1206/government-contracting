"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { marketingEvent } from "@/lib/client/marketing-event";

export function MarketingAnalytics() {
  const path = usePathname();
  useEffect(() => {
    marketingEvent("marketing_page_view");
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin || !["/signup", "/demo", "/pricing-guide"].includes(url.pathname)) return;
      marketingEvent("cta_click", { target: url.pathname, location: link.closest("header") ? "header" : link.closest("footer") ? "footer" : "content" });
    };
    const played = new WeakSet<HTMLVideoElement>();
    const onPlay = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !video.controls || played.has(video)) return;
      played.add(video); marketingEvent("walkthrough_play", { location: "content" });
    };
    document.addEventListener("click", onClick);
    document.addEventListener("play", onPlay, true);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("play", onPlay, true); };
  }, [path]);
  return null;
}
