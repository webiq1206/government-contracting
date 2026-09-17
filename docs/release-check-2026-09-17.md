# Mobile and interaction release check

This change refines the mobile hero, removes automatic industry scrolling,
adds progressive section reveals, stabilizes product-tour panels, and makes
the mobile trial CTA respond to other visible trial buttons. Phones use the
existing BrostCo poster without downloading decorative video. Larger screens
play a bounded introduction and then retain a still frame. Product tours remain
available on demand with captions and transcripts.

## Automated release gates

The pull request must pass TypeScript, the production build, application tests,
native PostgreSQL tests, and the desktop/tablet/mobile UI audit before merge.
The browser audit adds 320/390/430px hero checks, keyboard industry browsing,
stable tour dimensions, contextual CTA behavior, and reduced-motion handling.
Mobile WebKit adds a Safari-engine compatibility check, menu/scroll recovery,
zero decorative-video requests, and content visibility without JavaScript.
These tests use disposable records and block external provider traffic.

The first WebKit run caught an existing no-JavaScript failure: the root loading
boundary left the async homepage hidden. Loading UI is now scoped to the
authenticated route groups so public HTML can render without client scripts.

## Production evidence still required

Repository checks are not certification of the deployed environment. Before
claiming full production readiness, record these results against the deployed
commit in the release record:

- Physical iPhone Safari: portrait/landscape, browser toolbar changes, text
  enlargement, VoiceOver, trial entry, navigation, and product playback.
- Deployed signup and account recovery, with an isolated test organization.
- Stripe test-mode checkout, cancellation, and webhook reconciliation using
  the deployed configuration. Do not create real charges for this check.
- Connected-provider sandbox tests, including an expired credential, timeout,
  retry, and recovery. Use controlled recipients for communications.
- Verify monitoring delivery and an isolated backup restore, including a
  rollback rehearsal. Follow the environment's runbook and avoid interrupting
  live workers or webhooks as part of a UI release.
- Measure page loading and layout stability on a throttled connection and
  production devices. Synthetic browser navigation time is not field data.

No new environment variables or database migrations are introduced here.
Application rollback is redeployment of the prior main commit, f531636.
Earlier audit documents retain their historical findings; this note does not
claim that their outstanding operational items have been closed.
