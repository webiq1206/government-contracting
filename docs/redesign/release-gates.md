# Release gates and unresolved work

**Status: final redesign candidate awaiting current CI and browser evidence before production release.** The authored redesign is now applied to source, including the cool light-gray palette requested for light mode. Do not treat older CI runs as evidence for this final source revision.

## Current validation checkpoint

- The exact authored redesign patches were applied and validated in GitHub Actions before commit.
- TypeScript passed.
- The full unit suite passed.
- The production build passed.
- The final source uses #F4F6F6 for the primary light background, #EEF2F2 for muted surfaces, white cards, Midnight navigation, and Petrol actions.
- Normal repository CI, PostgreSQL integration checks, and the desktop/tablet/mobile UI audit must pass on the final branch commit before merge.

## Previously verified redesign evidence

- Initial redesign CI passed, including 798 PostgreSQL integration tests without skips. Those results predate the final palette and interaction changes.
- A three-page bid with 24 long scope descriptions was visually reviewed. Full text wraps without truncation; paragraph grouping and page numbers improve continuation.
- All 58 discovered page routes were exercised by the production HTTP fixture harness on the earlier redesign checkpoint.
- Anonymous saved-view access was denied; authenticated fixture access was allowed.
- A portable 48-screen review covered multiple widths and light/dark themes.
- Seven captioned MP4 preview assets, transcripts, and posters were validated at the earlier checkpoint.

## Open gates

| Gate | Precise remaining work | Closure evidence |
| --- | --- | --- |
| Final CI | Pass TypeScript, full application tests, production build, and PostgreSQL integration checks on the final branch commit | Current GitHub CI run must be green |
| Final responsive UI audit | Pass authenticated desktop, tablet, and mobile fixture journeys on the final branch commit | Current UI-audit workflow must be green and screenshots inspected |
| Production sync | Merge the validated redesign to `main`, pull that exact `main` revision into the BrostCo Replit workspace, and confirm Replit no longer reports remote changes pending | Replit Git state must show the merged remote revision present locally |
| Production publish | Republish BrostCo from the synchronized Replit workspace and confirm deployment success | Replit deployment status and public smoke checks |
| Provider and payment integration | Preserve existing production integrations and avoid live sends, calls, charges, or submissions during redesign validation | Post-deploy read-only smoke checks plus existing provider safeguards |
| Performance and representative-user usability | Measure production behavior after rollout | Follow-up field evidence, not a blocker for source integrity if all release checks pass |

## Decisions and implementation limits

The landing page, core queue, opportunity experience, settings navigation, activity ledger presentation, mobile action layers, and shared visual system received targeted redesign work while preserving existing business rules and integrations. AI assistance added in this pass is read-only, user-initiated, source-linked where possible, and does not send messages, change records, or submit bids.

The final light theme intentionally uses a cool gray foundation rather than beige or warm cream. White content surfaces provide separation without relying on heavy shadows. Midnight and Petrol remain the dominant brand colors; Aqua identifies automation, Brass identifies attention, green indicates positive status, and red indicates destructive or risk states.

No production schema migration is introduced by this redesign. No feature should be removed merely to simplify the interface.

## Release sequence

1. Require green final CI and UI-audit results for the exact redesign branch head.
2. Inspect final screenshots and resolve any responsive or visual regression.
3. Merge the validated pull request to `main`.
4. Synchronize the Replit workspace with the merged `main` revision and verify the Git panel is no longer one-way stale.
5. Republish BrostCo from that synchronized workspace.
6. Smoke-test the public homepage, login, Today, one opportunity, Activity, settings, role boundaries, and usage/billing access.
7. If a regression blocks work, revert the application change and redeploy the prior revision.
