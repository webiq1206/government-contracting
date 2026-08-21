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
