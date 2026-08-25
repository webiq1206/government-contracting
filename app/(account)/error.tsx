"use client";

import { RouteError } from "@/components/route-error";

/**
 * The account pages had no boundary at all, so a failure here fell through to
 * the framework's default screen: a bare "Application error" with no digest,
 * no recovery, and no way back. Billing is the page a worried customer opens.
 */
export default function AccountError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="account" backHref="/today" backLabel="Back to Today" />;
}
