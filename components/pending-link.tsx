"use client";

import Link, { useLinkStatus } from "next/link";
import { forwardRef, type ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/** Native link status follows the latest navigation, including cancellations.
 * A separate transition per link leaves older links spinning when users move on.
 * Dense work queues should fetch the selected destination, not every visible row. */
export const PendingLink = forwardRef<HTMLAnchorElement, Props>(function PendingLink(
  { href, children, prefetch = false, ...props }, ref
) {
  return (
    <Link
      {...props}
      ref={ref}
      href={href}
      prefetch={prefetch}
    >
      {children}
      <PendingIndicator />
    </Link>
  );
});

function PendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span role="status" className="ml-1 inline-flex shrink-0 items-center">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">Loading page</span>
    </span>
  ) : null;
}
