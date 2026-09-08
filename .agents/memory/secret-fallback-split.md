---
name: Secret fallback splits ciphertext across keys
description: Why an encryption key resolved through a fallback chain silently orphans older rows, and what a rotation must do about it.
---

# A fallback chain in the encryption key silently splits the data at rest

When the key for encrypting stored credentials is resolved as "primary secret, else fallback
secret", every row is encrypted under whichever secret happened to be present the day it was
written. Adding the primary later does not migrate anything: new writes go under the primary,
old rows stay under the fallback, and the table quietly ends up split across two keys.

Nothing fails while decryption is lenient. The break comes later, from an unrelated change --
making an unreadable credential fatal, or a deploy that changes which secrets the process holds.
Then every job touching an old row dies at once, with an error naming the primary secret as the
thing to restore, when the primary is already correct and nothing is damaged.

**Why:** this cost a full production outage. Half the credentials read under a host-provisioned
session secret, half under an operator-created one added weeks later. The symptom pointed at the
wrong secret entirely, so the obvious repair (re-set the primary) would have changed nothing.

**How to apply:**

- Decrypt against every secret the deployment holds, in priority order; encrypt only under the
  primary. Throw only when none of them reads the value, and say so in the message.
- Ship a rekey job with the change: rewrite every readable row onto the primary and name the
  rows no held secret can read. Retiring an old secret is then a decision, not a discovery.
- Diagnosing this: try each held secret against each row and report ok/fail per row. A split
  result -- some rows under one secret, some under the other -- is the signature. Rows that fail
  under all held secrets are the only genuinely lost ones.
- The `updated_at` of each row tells you when the cutover happened; it lines up exactly with the
  date the newer secret was introduced.
