# Exact authored source import

The four plaintext patches in this directory were authored and tested directly outside Replit. Apply them unchanged, in numeric order, to the existing `redesign/complete-platform` source. Do not regenerate the design or rewrite the supplied edits. Preserve all unrelated work. Stop on any checksum mismatch or application conflict.

| File | SHA-256 |
| --- | --- |
| 01-brand.patch | dc7a8fa78579e524a95449316f9d2be1da74fd9cd258f3058d30f6eba04ad425 |
| 02-marketing.patch | 6f9ce04a236f85c6602347b07cc4ab4b6a1ba97a4416a13aef02c1f8058b52f2 |
| 03-workflow.patch | 6b5d814b8a3b8e9954dd53b6063fcf0ce5961bfd739bb2fbefdafdcf5b20d35f |
| 04-tests.patch | bcbe318db8c3e8e996b48b737408302a87f1cf9385d2c45d26b54917c571d732 |

Only these four patches are authorized for this import. The additional browser-recording changes were not uploaded and must not be recreated. Keep the existing browser-audit and CI workflows unchanged.

After exact application, remove these four temporary patches and this README from the final source commit. Push the resulting application source to the existing redesign branch for normal CI. Do not merge, publish, perform database operations, run workers, or make external sends as part of the import. Return the resulting commit and any failed checks.

Local evidence on the authored application changes: TypeScript passed. The full unit run passed 4,482 tests, with 735 database-dependent tests skipped. The separate normal CI database job must still run. The final production build and rendered browser acceptance have not yet been verified for these edits. The earlier successful CI runs predate these edits and are not evidence for them.

Existing Replit workspace was last reported clean on main at b32c5679dbd2fae94124fedb519479e3cf70260a, with one local publish commit. Preserve that commit and any newly discovered workspace changes. Do not force-update or discard them.
