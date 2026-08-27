import Link from "next/link";

/**
 * The page somebody lands on when a link is old or a record is gone.
 *
 * Three things were wrong with the version this replaces, and each of them is
 * the kind that only shows up when the page is measured rather than looked at.
 *
 * It had no h1, so a screen-reader user arriving here had nothing to land on
 * and no way to tell an error page from a slow one. The "404" was a paragraph,
 * which is what a number should be, but then nothing else was a heading
 * either.
 *
 * The number was `text-slate-300`, which is 1.68:1 against the dark theme's
 * background: a 48px glyph nobody with ordinary eyesight can read on the
 * theme half this product's operators use.
 *
 * And it offered "Back to pipeline" for a destination the navigation calls
 * Opportunities.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      {/* Decoration beside the sentence that actually says what happened. */}
      <p aria-hidden className="num text-5xl font-bold text-muted-foreground">
        404
      </p>
      <h1 className="font-display text-2xl font-normal text-foreground">
        That page or record does not exist
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be old, or the record may have been deleted. Nothing was changed.
      </p>
      <Link href="/pipeline" className="btn-primary">
        Back to Opportunities
      </Link>
    </main>
  );
}
