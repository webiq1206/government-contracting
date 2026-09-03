# Retired branches

Every branch here had its work merged into `main` and was then left behind. They
are recorded because deleting a branch is not quite reversible: GitHub keeps an
unreferenced commit reachable by SHA for a while and then garbage-collects it,
so the tip is written down before anybody removes the ref.

Two facts about this repository make the usual check useless, and are the
reason this file states the evidence rather than assuming it:

The history was rewritten at some point. Twenty of these branches share **no
common ancestor** with `main`, so `git merge-base` returns nothing and
`git diff main...branch` reports no differences no matter what the branch
contains. That empty diff reads as "already merged" and means nothing at all.
A full two-dot compare against `main` shows well over a thousand files
differing, which also means nothing: most of it is `main` having moved on.

So the evidence that the work landed is the **merged pull request**, listed per
branch below. Nothing here was judged from the diff.


## The branches

| Branch | Tip | Last commit | Merged as | Subject |
| --- | --- | --- | --- | --- |
| `claude/email-attachments-subcontractors-a17csq` | `0e57ccffb1140a5272f895573522285230442d00` | 2026-08-28 | #92 | Outreach packets: only this trade's documents, renamed f |
| `claude/git-sync-check-nqy8by` | `19a4bceea79c71ea362e85ec92b2cfde93884dc7` | 2026-08-27 | #91 (and 69 earlier, this branch was reused) | Merge pull request #91 from webiq1206/claude/git-sync-ch |
| `claude/git-sync-check-nqy8by-mobile` | `0b2b91ffbb29d42b132e8c67d34b4b31b0d791a8` | 2026-08-15 | #19 | Keep the pipeline horizontal on a phone |
| `claude/mobile-logout` | `534e6ed012630ae42d55cb0209cbe670406319d2` | 2026-08-15 | #20 | Make signing out findable on a phone |
| `claude/mobile-pipeline-fixes` | `3c46d04b1cdfeaf233cb223c9b3e402fa888ea0e` | 2026-08-15 | #22 | Fix the two things the mobile rail did wrong once you lo |
| `claude/qa-fixture-pages` | `97418093308fca70b89ab6dfe57de54c72a03caa` | 2026-08-15 | #23 | Make the call workspace and the nav drawer openable with |
| `claude/test-env-isolation` | `5903a858f50a11b3fb48cae8f8ea01babaa8f50a` | 2026-08-15 | #21 | Stop the unit suite reading whoever's .env is on the mac |
| `cursor/admin-ia-clarity-5f54` | `3bf96089d618a79a11db5d277e667fcd0ea2861e` | 2026-08-11 | #6 | Rewrite How it works with every current pipeline step |
| `cursor/admin-ia-scannability-5f54` | `fa5dfecc646e9f59f990051c9968248ca6975eb4` | 2026-08-11 | #11 | Reorganize admin IA for scannable workflows and clearer  |
| `cursor/fix-pursue-button-elongate-5f54` | `b917dc70759ec4511f31eef7ba4f4531dff89b31` | 2026-08-11 | #2 | Fix Pursue button stretching on the next Today task |
| `cursor/how-it-works-steps-5f54` | `f91a9ed5b1df6c04693de1ca70d0f165880080e4` | 2026-08-11 | #7 | Rewrite How it works with every current pipeline step |
| `cursor/master-pause-everything` | `4f96d7cdb806bbbc84dc7af056a9b4b652d7beae` | 2026-08-11 | #15 | Make the automation master switch a full kill switch |
| `cursor/mobile-optimization-5f54` | `6f061592b1719d205936fcc3ce419c2567146afe` | 2026-08-11 | #5 | Resolve merge conflict with main on Today pursue button |
| `cursor/opportunity-page-clarity-5f54` | `a9ce7cb260b2c013eb02af438ddef351a33b54be` | 2026-08-11 | #4 | Anchor attachments panel for sticky jump-link scrolling |
| `cursor/pricing-comps-explain-5f54` | `1defbf01f2950c67ab72c20c4f26b48440a5bf27` | 2026-08-11 | #12 | Merge origin/main into pricing-comps-explain; keep both  |
| `cursor/public-launch-saas-5f54` | `10bec4f80d32cf853355e268b2a7bbeff31c5299` | 2026-08-11 | #13 | Merge origin/main into public-launch-saas; resolve queue |
| `cursor/resend-completes-email-setup-5f54` | `1ff74c88905b5dd373afcbd24af5c07004a66a00` | 2026-08-11 | #1 | Treat Resend as completing the email setup checklist ste |
| `cursor/skip-calling-from-today-5f54` | `53fc3e12417a6edb4a83cad39e3eb99701d8d6b7` | 2026-08-11 | #3 | Document Skip calling in the Call Queue help panel |
| `cursor/solicitation-outreach-ux-gates` | `a793eef5458774068bf8956d8f3869f6fae10247` | 2026-08-11 | #16 | Merge origin/main; keep master-pause comment on StepInpu |
| `cursor/sub-contact-required-5f54` | `2ff0e241fab328443d400c234d4a06b14fa20d0f` | 2026-08-11 | #10 | Resolve merge conflicts with main on call-prep and outre |
| `cursor/sub-work-plain-english-5f54` | `0729ea1aafe505f6fce9277c3d6c31674a8406c6` | 2026-08-11 | #9 | Update outreach template wording for work description |
| `cursor/today-pipeline-top-5f54` | `8da8650e6adbe204563f8b53f9c9ce8f08a68b42` | 2026-08-11 | #8 | Move Today pipeline strip to the top of the page |

## Restoring one

```
git fetch origin <tip-sha>
git branch <name> <tip-sha>
```

Or on GitHub, the branch list offers Restore for a recently deleted branch
without needing the SHA. Past the garbage-collection window the SHA above is
the only handle left, which is what this file is for.

## Deleting them

Not done from a Claude Code session: the credential there can push commits but
not delete refs, and GitHub answers 403. From a checkout with push rights:

```
git push origin --delete \
  claude/email-attachments-subcontractors-a17csq \
  claude/git-sync-check-nqy8by \
  claude/git-sync-check-nqy8by-mobile \
  claude/mobile-logout \
  claude/mobile-pipeline-fixes \
  claude/qa-fixture-pages \
  claude/test-env-isolation \
  cursor/admin-ia-clarity-5f54 \
  cursor/admin-ia-scannability-5f54 \
  cursor/fix-pursue-button-elongate-5f54 \
  cursor/how-it-works-steps-5f54 \
  cursor/master-pause-everything \
  cursor/mobile-optimization-5f54 \
  cursor/opportunity-page-clarity-5f54 \
  cursor/pricing-comps-explain-5f54 \
  cursor/public-launch-saas-5f54 \
  cursor/resend-completes-email-setup-5f54 \
  cursor/skip-calling-from-today-5f54 \
  cursor/solicitation-outreach-ux-gates \
  cursor/sub-contact-required-5f54 \
  cursor/sub-work-plain-english-5f54 \
  cursor/today-pipeline-top-5f54
```

`main` and any branch currently in use are deliberately absent from that list.

