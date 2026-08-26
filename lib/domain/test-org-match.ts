/**
 * Recognising a leaked test-fixture organization, and nothing else.
 *
 * This is the safety-critical half of the test-org cleanup: a false positive
 * here deletes a real customer's whole account, unrecoverably. So the rule is
 * strict and needs TWO independent signals, and the "real" side always wins.
 */

/**
 * Name prefixes the integration suite uses, taken from the tests themselves.
 * A match here is necessary but NOT sufficient — the generated-tag check below
 * is what makes it safe, because a real customer could type "Applied Co" but
 * never "Applied Co b0c2b405".
 */
export const TEST_ORG_PREFIXES = [
  "attack-", "maint-a-", "maint-b-", "comp-a-", "comp-b-", "comp-good-",
  "comp-other-", "iso-a-", "iso-b-", "learn-a-", "learn-b-", "replyiso-a-",
  "replyiso-b-", "runner-a-", "runner-b-", "score-a-", "score-b-", "callsync-",
  "bounce-", "bounce-other-", "sup-", "sup-other-", "onebid-", "bb-", "sub-",
  "applied co ", "unstamped co ", "bound co ", "comped co ", "existing co ",
  "gone co ", "late co ", "typo co ", "race co ", "race revoke co ",
  "reyes builders ", "alpha constructors", "bravo builders", "firm ",
  "doomed org ", "admin test org ", "award-", "bill-", "del-", "del2-",
  "sec-org-", "submit-",  "wf-",
];

/**
 * A trailing generated tag: a full UUID, or a whitespace/hyphen-separated run
 * of 8+ hex characters at the end. This is the discriminator — real company
 * names do not end in one.
 */
const TAG_SUFFIX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|[\s-][0-9a-f]{8,}$/i;

/**
 * True only when the name both starts with a known test prefix AND ends in a
 * generated tag. Billing status is checked separately by the caller: an org
 * with a Stripe id is real no matter what its name looks like.
 */
export function looksLikeTestOrg(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (!TAG_SUFFIX.test(n)) return false;
  const lower = n.toLowerCase();
  return TEST_ORG_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * True when a name ends in a generated tag, whatever it starts with.
 *
 * This is deliberately separate from the full match. A hand-kept prefix list
 * always lags the suite -- "Doomed Org" reached production and was audited as
 * a real customer because no prefix covered it -- so the callers use this to
 * REPORT the near misses rather than act on them. Nothing is ever deleted on
 * this signal alone; it exists so a fixture the list has not learned yet is
 * visible instead of silent.
 */
export function hasGeneratedTag(name: string | null | undefined): boolean {
  return TAG_SUFFIX.test((name ?? "").trim());
}

/**
 * An address that cannot belong to a real customer.
 *
 * RFC 2606 reserves `.test` and the `example.*` domains precisely so nobody
 * can register them, which makes this a signal with no false positives rather
 * than a heuristic. That is why it needs no second discriminator, unlike the
 * name matching above.
 *
 * Deliberately for HIDING rows, never for deleting them. The organization
 * matcher is strict because a false positive there destroys a customer's
 * account; this one only decides whether a log line appears in the default
 * view, and `?tests=1` brings everything back regardless. Do not reach for it
 * from the purge tool.
 */
export function looksLikeTestEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return false;
  const domain = e.slice(at + 1);
  if (!domain) return false;
  return (
    domain === "test" ||
    domain.endsWith(".test") ||
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain.endsWith(".example.com") ||
    domain.endsWith(".example.org") ||
    domain.endsWith(".example.net")
  );
}
