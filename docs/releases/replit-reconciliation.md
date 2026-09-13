# Replit history reconciliation

The user preserved and pushed Replit's committed workspace as
`backup/replit-before-main-sync`, at
`24bb077f91fc45a53210b4325b79282149362c57`.
The reconciliation joins that history with validated main
`f01874fa78fd6afc9d126d832c0154bf16c61d7e` using both commits as parents.
The backup remains intact.

## Conflict decisions

- Keep main's five primary destinations, including Contracts. The older
  four-destination navigation and its test are superseded by the approved
  contract workspace work.
- Preserve both sets of account-shell regression assertions: streamed task
  counts plus queue loading, automation health and automation state.
- Preserve Replit's `linkedom` development dependency update and exact locked
  versions/checksums. Replace Replit-internal package download addresses with
  the corresponding public npm registry addresses so CI can install them.
- Keep the current application source unchanged. The focused Today, mobile
  scroll behavior, contract controls and scoped guidance remain as validated
  on main. No database migration or production data change is introduced.

## Workspace completion

Replit still has an unfinished merge on `reconcile/replit-main`. Once the
reconciliation PR passes checks and merges, cancel only that unfinished merge,
fetch origin, switch to main and fast-forward to origin/main. Both original
histories will then already be included; do not resolve the old conflicts a
second time, discard committed work, or force-push.

Confirm a clean main working tree and the published main revision before
republishing. No Replit Agent prompt is needed for these Git operations.
