/**
 * What a product-analytics event is allowed to carry.
 *
 * The rule this enforces: no solicitation, contact, message, document or
 * account content may end up in an analytics row. Not because anything sends
 * it today, but because nothing stopped it. `trackEvent` took
 * `Record<string, unknown>` and an arbitrary `path`, and the API route behind
 * it passed both straight through from the request body. The shape invited a
 * subcontractor's email address, a solicitation title, or a search term, and
 * the first one to arrive would have looked exactly like the others.
 *
 * So the filter lives at the sink rather than at each call site. Call sites are
 * where it gets forgotten: there are a dozen of them, they are added by
 * whoever is building the feature, and none of them is thinking about privacy
 * at the moment they type `meta:`.
 *
 * What survives is what a funnel actually needs: counts, flags, plan names,
 * and short enumerated words. What does not survive is free text, which is
 * where the sensitive things live.
 */

/**
 * Longest string an analytics value may be.
 *
 * Generous, because the legitimate values include a Stripe checkout session
 * id, which runs past sixty characters. Length is not what separates a safe
 * value from an unsafe one; see the whitespace rule below.
 */
const MAX_STRING = 100;
/** Most keys one event may carry. */
const MAX_KEYS = 12;
/** Most items in an array value. */
const MAX_ITEMS = 10;

/** Anything shaped like a way to reach a person. */
const CONTACT = /@|\+?\d[\d\s().-]{7,}/;

/**
 * A single value, or null if it must not be stored.
 *
 * Numbers and booleans always pass: they cannot carry a name.
 *
 * A string passes only if it contains no whitespace. That is the line between
 * a token and prose, and it is a brighter one than length. The first version
 * of this capped strings at 64 characters, and a real probe put through the
 * real route showed "Roof Replacement and Associated Sheet Metal Work,
 * Building 402" landing in the table intact at 62. A solicitation title is
 * precisely what must not be here.
 *
 * Every value this codebase legitimately sends is a single token: `founding`,
 * `standard`, `monthly`, `STRIPE_SECRET_KEY`, a Stripe session id, a page key.
 * Anything with a space in it is a sentence or somebody's name.
 *
 * The cost is that a Stripe error message no longer reaches analytics. That is
 * the right trade: it is prose from a third party, it can name a card, and it
 * is already in the server log where somebody debugging would look.
 */
function safeValue(v: unknown): string | number | boolean | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "" || s.length > MAX_STRING) return null;
  if (/\s/.test(s)) return null;
  if (CONTACT.test(s)) return null;
  return s;
}

/**
 * The meta an event may store.
 *
 * Nested objects are dropped rather than walked. A nested object in an
 * analytics payload is almost always a record that got passed by mistake, and
 * recursing would preserve exactly the thing this exists to remove.
 */
export function safeMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out: Record<string, unknown> = {};
  let dropped = 0;
  for (const [rawKey, value] of Object.entries(meta as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) {
      dropped++;
      continue;
    }
    const key = rawKey.slice(0, 40);
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map(safeValue).filter((x) => x !== null);
      if (items.length > 0) out[key] = items;
      else dropped++;
      continue;
    }
    const safe = safeValue(value);
    if (safe === null) dropped++;
    else out[key] = safe;
  }
  /*
   * Says that something was removed, without saying what.
   *
   * A silently thinner payload is the analytics version of the problem this
   * whole audit is about: somebody reads the events, sees no `error` key, and
   * concludes the error never happened. This way the row admits it is partial.
   */
  if (dropped > 0) out.dropped_keys = dropped;
  return out;
}

/**
 * The path an event may store: a route, not a record.
 *
 * The query string goes, because that is where free text lives: `?q=rivera
 * roofing` is a search for a named company. Record ids are replaced with a
 * placeholder, because `/opportunity/<uuid>` is a reference to one
 * solicitation while `/opportunity/:id` is the fact that somebody opened an
 * opportunity, and only the second is what a funnel is asking.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A long opaque token in a path: a share link, an invite, a reset. */
const TOKEN = /\/[A-Za-z0-9_-]{24,}(?=\/|$)/g;

export function safePath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const raw = path.trim();
  if (raw === "") return null;
  // Split rather than parse: this is given a pathname, not a full URL, and a
  // URL constructor would need a base and would accept an absolute one from
  // another origin.
  const withoutQuery = raw.split("?")[0].split("#")[0];
  if (!withoutQuery.startsWith("/")) return null;
  const normalized = withoutQuery.replace(UUID, ":id").replace(TOKEN, "/:token");
  return normalized.slice(0, 120);
}
