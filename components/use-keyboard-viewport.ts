"use client";

import { useEffect, useState } from "react";

/** The visible area above an on-screen keyboard. Pinch zoom keeps native behavior. */
export function useKeyboardViewport() {
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        const editing = focused instanceof HTMLElement &&
          (focused.matches("textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file])") || focused.isContentEditable);
        const keyboard = editing && Math.abs(visual.scale - 1) < 0.01 && window.innerHeight - visual.height > 120;
        const next = keyboard ? { height: Math.round(visual.height), top: Math.round(visual.offsetTop) } : null;
        setViewport(current => current?.height === next?.height && current?.top === next?.top ? current : next);
      });
    };
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return viewport;
}
