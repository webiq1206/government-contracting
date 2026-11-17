import Link from "next/link";
import type { SpendingNotice } from "@/lib/domain/spending-notice";

/**
 * Persistent notice when paid AI is stopped.
 * Not dismissible: a hidden limit is how a blocked account looks like it is running.
 */
export function SpendingBlockBanner({ notice }: { notice: SpendingNotice }) {
  return (
    <div role="alert" className="border-b border-risk/50 bg-risk/10 px-4 py-3 text-sm text-foreground">
      <p className="font-semibold text-risk">{notice.title}</p>
      <p className="mt-1 max-w-3xl leading-relaxed">{notice.detail}</p>
      <Link href={notice.actionHref} className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent hover:underline">
        {notice.actionLabel}
      </Link>
    </div>
  );
}
