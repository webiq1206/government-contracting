"use client";

import { RouteError } from "@/components/route-error";

/**
 * Every page outside the operator shell: sign-in, sign-up, invitations,
 * password reset, the vendor portal and the public site. These had no
 * boundary of their own, so a failure there was a blank screen.
 */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="dashboard" backHref="/" backLabel="Back to the home page" />;
}
