"use client";

import { RouteError } from "@/components/route-error";

/**
 * A Today failure stays on this segment. The dash-wide boundary sends people
 * back to /today, which reloads the same page. Automation Health is a
 * different route, so a crash here does not immediately ask for Today again.
 */
export default function TodayError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="today"
      backHref="/agents"
      backLabel="Open Automation Health"
    />
  );
}
