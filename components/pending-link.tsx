"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useTransition, type ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/** Keep native link behavior while showing feedback during route transitions. */
export const PendingLink = forwardRef<HTMLAnchorElement, Props>(function PendingLink(
  { href, children, onClick, replace, scroll, ...props }, ref
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Link
      {...props}
      ref={ref}
      href={href}
      replace={replace}
      scroll={scroll}
      aria-busy={pending || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.download || (props.target && props.target !== "_self")) return;
        const target = new URL(href, window.location.href);
        if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
        event.preventDefault();
        if (pending) return;
        startTransition(() => {
          if (replace) router.replace(href, { scroll });
          else router.push(href, { scroll });
        });
      }}
    >
      {children}
      {pending && (
        <span role="status" className="ml-1 inline-flex shrink-0 items-center">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
          <span className="sr-only">Loading page</span>
        </span>
      )}
    </Link>
  );
});
