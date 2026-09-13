# Connected workspace continuation

## Recovered source

The source transfer patch previously stored on `implementation/connected-workflows`
is now applied to the actual application. It adds the focused Today screen,
retains the full task views behind a disclosure, preserves existing hash links,
separates account controls from Workspace destinations, and uses the same
Settings selector on every viewport. Completed transfer files and their
temporary packaging workflows have been removed.

The browser audit was still clicking the retired Settings disclosure and My
Work navigation item. It now exercises Account controls and the current
Opportunities destination, preserving the focus-restoration, menu-isolation,
interrupted-navigation, and unsaved-settings assertions.

The desktop detail drawer now measures the available viewport height below
its current position and scrolls its content internally. It remains a side
column on desktop and a native modal on smaller screens.

## Verification

- Standalone TypeScript check passed on the recovered source.
- Application tests: 4,494 passed; 735 database-dependent tests skipped.
- Full production build passed, including its TypeScript check.
- Current responsive browser checks and GitHub's separate PostgreSQL gate
  must finish on the resulting source revision before release.

## Reconciliation and scope still open

Replit reported a clean working tree at
`24bb077f91fc45a53210b4325b79282149362c57` on `fix/mobile-scroll-homepage`.
Its application files match the earlier authored focused-dashboard patch.
It also has local dependency and closed-work test changes that must be
preserved during any future merge. Replit main was still
`b36be34a0a27875055ed58510792bd9d93ac6aed`. A successful deployment status
does not prove that it contains this continuation's changes.

The linked September 12 ChatGPT conversation could not be retrieved through
the available conversation search or URL lookup. The newer PR description
lists connected records, reviewed modifications with source evidence,
reusable knowledge, source-grounded AI, requirement-to-response coverage,
pricing coverage, saved views, and reusable review procedures. These are not
implemented by the recovered focused-dashboard patch. The exact latest
requirements and acceptance decisions must be recovered before this broader
delivery can be called complete.

Do not treat this source recovery as completion of those modules, a merge to
main, Replit synchronization, or a new production deployment.
