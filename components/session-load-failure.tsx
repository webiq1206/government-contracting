import Link from "next/link";

/**
 * A session cookie exists independently of the database reads that attach its
 * account and organization. If those reads fail, the honest state is neither
 * signed out nor "finish signup": it is temporarily unavailable.
 */
export function SessionLoadFailure() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div role="alert" className="w-full max-w-lg rounded-md border border-risk/30 bg-risk/5 p-6 text-center">
        <h1 className="font-display text-xl font-semibold">Your account could not be checked</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Brost Co could not read your session or organization. You have not been signed out,
          and no account data was changed. Try again before signing in or creating another
          account.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/today" className="btn-primary">
            Try again
          </Link>
          <Link href="/" className="btn-ghost">
            Go to the home page
          </Link>
        </div>
      </div>
    </main>
  );
}
