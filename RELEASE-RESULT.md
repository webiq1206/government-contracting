# RELEASE-RESULT

Temporary, not to be committed. No secret values appear here. Production database only.

## Commit

    c7212be  Recover the production workflow: read credentials under every held secret,
             and stop calling drafts sent (#121)

Workspace `main` was hard reset to `origin/main` (c7212be); the 8 local checkpoint commits were
discarded. My agent memory notes were preserved and restored into the working tree.
`npm install` was NOT run: package-lock.json is unchanged between the old HEAD and c7212be
(package.json changed, the lockfile did not).

## Migrate (MIGRATION_DATABASE_URL set to the production owner connection string)

    [migrate] 111 migration file(s), 110 already applied, 1 pending: 111_communications_draft_state.sql
    [migrate] + applied 111_communications_draft_state.sql in 0.2s
    [migrate] applied 1 migration(s).

Ledger after: 112 rows, latest = 111_communications_draft_state.sql.

## Rekey (npm run db:rekey-secrets, no AUTH_SECRET_PREVIOUS set)

    [rekey] 2 secret(s) available to read under.
    [rekey] + ANTHROPIC_API_KEY for org 00000000-0000-4000-8000-000000000001: rewritten under the current secret.
    [rekey] + AHREFS_API_KEY for org 00000000-0000-4000-8000-000000000001: rewritten under the current secret.
    [rekey] + RESEND_API_KEY for org 00000000-0000-4000-8000-000000000001: rewritten under the current secret.
    [rekey] + GMAIL_SENDER for org 00000000-0000-4000-8000-000000000001: rewritten under the current secret.
    [rekey] + DIGEST_EMAIL_TO for org 00000000-0000-4000-8000-000000000001: rewritten under the current secret.
    [rekey] + RESEND_WEBHOOK_SECRET for org 00000000-0000-4000-8000-000000000001: rewritten under the current secret.
    [rekey] done: 6 rewritten, 3 already current, 0 unreadable.

Six rewritten keys match the six predicted; the 3 already current are GOOGLE_MAPS_API_KEY,
SAM_API_KEY, and the Gmail refresh token. Nothing was unreadable.

## Post-rekey verification (read-only, throwaway script, deleted after the run)

All nine stored credentials now read under the primary secret alone:

    AHREFS_API_KEY, ANTHROPIC_API_KEY, DIGEST_EMAIL_TO, GMAIL_SENDER, GOOGLE_MAPS_API_KEY,
    RESEND_API_KEY, RESEND_WEBHOOK_SECRET, SAM_API_KEY, gmail refresh_token
    -> AUTH_SECRET = ok (all 9), SESSION_SECRET = fail (all 9)

The split is gone. Nothing depends on the host-provisioned secret any more, so it can be
retired deliberately rather than discovered by another outage.

## Communications counts after migration 111

    delivery_state = 'draft'                        | 392
    delivery_state = 'failed' AND provider IS NULL  | 0
    delivery_state = 'sent'  AND provider IS NULL   | 785   (note-channel rows, not email)

The 392 are exactly the email rows that previously claimed 'sent' with no provider: the 252
addressed to subcontractors and the 140 sources-sought responses. None were reclassified as
'failed'.

Not published. Deploy is left to the operator.
