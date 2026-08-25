"use client";

import { RouteError } from "@/components/route-error";

/** Every operator page under (dash). */
export default function DashboardError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="dashboard" backHref="/today" backLabel="Back to Today" />;
}
