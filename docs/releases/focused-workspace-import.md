# Focused dashboard source transfer

The adjacent focused-workspace-import.patch is the exact authored release patch. Its SHA-256 is d59c813ef6d98daa1ecaf04f06c589f5460a550cfd9e2fa7f3d92cce4e47947a and its Git blob SHA is e21c04f6bc9f26317c8b8f96dd9af6a982553b20. It was generated from the tracked source at f557b90ddd6d60524a9a49765e3e80609d6f0d22, based on the mobile-scroll/homepage source.

Import it without redesigning or rewriting the supplied changes. Preserve the current Replit workspace and its local dependency and closed-work test changes, last reported clean at c4771c99628e6bbb9d843e0f6be2c736ef7ca961. Reconcile that local history with the existing redesign/focused-workspace branch using a normal merge, never a reset or force push. Stop and report conflicts rather than discarding changes. Apply the patch only once, then remove this transfer manifest and the temporary patch from the final source commit. The patch removes only the already-completed source export workflow; existing CI workflows remain intact.

After import, these are the expected Git blob hashes for application files:

| File | Git blob hash |
| --- | --- |
| app/(dash)/more/page.tsx | 83a1a88548cd11b30ef74abb36d3871ea62ce2ab |
| app/(dash)/today/page.tsx | 9336000cdf6903179cbca47d487fc34ba39822ee |
| app/simplified-shell.css | 7a5fcd48667febbfbe38a178b617c7c3af6a3587 |
| components/badges.tsx | 73926737bc2aaec2b1bc1e7a223709c46f619244 |
| components/focused-today.tsx | 4732b71221e5ebc799dcf64155601c8a35372813 |
| components/nav.tsx | d36941a04169e8e3e1313fdb18139267490d2c0f |
| components/settings-nav.tsx | a91029657b71c877751c931510cd01a830add856 |
| components/today-details.tsx | 8273c92ba8d5e299500faaa6e310f8e3c2ce329a |
| lib/domain/focused-workspace.ts | 95841458f1b40d19dd8f4a5805f1614b177ba176 |
| lib/navigation.ts | acf1f5bf236c885534d313fdf93b31e9da24aa84 |

Local validation of the authored changes: standalone TypeScript passed; 4,494 unit/source tests passed, with 735 database-dependent tests skipped. Local production compilation succeeded, but the combined build exceeded the review container's memory during its TypeScript worker, so the complete production build remains to be verified in the actual release environment. No production database was touched, no provider calls were made, and no messages were sent.

Release behavior: four primary destinations; separate Workspace directory; account controls separate from navigation; one next task and up to three upcoming tasks on Today; original task sections still accessible through an explicit disclosure, existing query filters, and saved hash links; all existing business routes and permissions retained; one settings selector across devices; expanded page explanations optional. Preserve the existing mobile document scrolling fix, homepage, video assets, and deployment configuration.

Commit and push the resulting actual source to the existing redesign branch. Report the resulting commit, checksum verification, production build result, and working tree status before publishing. Do not start workers, change production data, change spending limits, send messages, or make charges as part of verification.
