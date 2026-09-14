"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep the text in its own grid row. Tall content uses normal document scroll. */
export function StickyColumn({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setFits(
        element.getBoundingClientRect().height <= window.innerHeight - 136,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`bco-sticky-column ${className}`}
      data-sticky-fit={fits ? "true" : "false"}
    >
      {children}
    </div>
  );
}
