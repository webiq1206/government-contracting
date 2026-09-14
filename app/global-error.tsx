"use client";

import Link from "next/link";

/**
 * The boundary of last resort, for a failure inside the root layout itself.
 * Renders its own html and body because the layout that would normally
 * supply them is the thing that failed. Plain markup on purpose: nothing
 * here may depend on the stylesheet or providers that did not load.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "3rem 1.5rem", color: "#1f2937", background: "#fafaf9" }}>
        <main style={{ maxWidth: "36rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>Brost Co could not load this page</h1>
          <p style={{ margin: "0 0 1rem", lineHeight: 1.5 }}>
            Something failed before the page could draw. Nothing you entered was lost on the server. Try again; if it keeps happening, tell us and include the code below.
          </p>
          {error?.digest && (
            <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#6b7280" }}>Error code: {error.digest}</p>
          )}
          <button type="button" onClick={() => reset()} style={{ minHeight: 44, padding: "0 1rem", borderRadius: 8, border: "1px solid #0E6F75", background: "#0E6F75", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>{" "}
          <Link href="/" style={{ display: "inline-block", minHeight: 44, lineHeight: "44px", padding: "0 1rem", color: "#0E6F75" }}>Back to the home page</Link>
        </main>
      </body>
    </html>
  );
}
