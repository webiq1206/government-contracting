# Owner-only production release

Do not add production migration credentials to Replit shared, development, web, or worker secrets. Isolated development now rejects an owner migration URL before opening a connection.

## One-time owner setup

In this GitHub repository, create an environment named `production-migrations`. Restrict deployment branches to main and enable required owner review where the repository plan supports it. Only trusted repository maintainers should be able to change or dispatch release workflows.

Inside that environment, add the secret `MIGRATION_DATABASE_URL` with the full production owner connection string. Add environment variables `PRODUCTION_DATABASE_HOST` and `PRODUCTION_DATABASE_NAME` with the independently verified live endpoint and database name. Do not create a repository-wide migration secret. Do not commit credentials or paste them into workflow inputs.

GitHub Actions is a separate owner-authorized release environment. It is not the development Agent or an application runtime. The workflow does not publish the app or start workers.

## Each release

1. Confirm a usable production recovery point and review pending SQL migrations for compatibility with the currently running release. Passing tests alone does not establish migration safety.
2. Open Actions, select **Owner production migrations**, choose main and the default **inspect** action. Approve the environment job when requested. Inspect is read-only and prints the source commit, database identity, pending migration names and checksum discrepancies, never the connection string.
3. Resolve discrepancies through owner review. Do not fabricate ledger entries or edit applied migrations. If there is no ledger, this workflow stops; it does not initialize a supposedly live database blindly.
4. After reviewing the inspect output and runtime test evidence, dispatch **apply** for the same main commit. It validates the independently configured target, applies the canonical migrations, and verifies the ledger on that same database. If main changes between inspect and apply, inspect again before approval.
5. Only after verification succeeds, publish the corresponding app release and verify its live model routing, health, authentication and key workflows. Existing environment overrides can supersede GPT-4.1 defaults.

The workflow is manual, serialized, main-only, and defaults to read-only inspection. The secret is exposed only to its migration step, not dependency installation. Creating the workflow does not configure environment protections or install secrets automatically; the owner must do that in GitHub.

## Synthetic development validation

`scripts/gpt41-smoke.ts` requires `RUN_GPT41_SMOKE=1`, isolated development, no migration URL, both routes set to GPT-4.1 and fallback disabled. It uses the isolated seed organization unless `GPT41_SMOKE_ORG_ID` selects an existing test organization. It exercises source-stated cents, price ranges and a conflicting amended deadline through application functions. Two extraction calls can each retry once; review has no retries, for a maximum of five completion attempts. Existing spending admission checks remain active. It logs sanitized synthetic results and usage ledger status, never credentials, and does not start workers, send outreach, submit bids or create customer records. These checks are samples, not a guarantee of accuracy or a substitute for scanned-document and authenticated UI testing.
