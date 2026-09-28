/**
 * Does a fetched body actually look like a sitemap, or just answer 200?
 *
 * Used before pushing URLs to IndexNow. A deployment can serve a 200 that is an
 * error page, a login redirect's HTML, or a sitemap route that threw and
 * rendered nothing useful; submitting against any of those tells four search
 * engines to recrawl pages on the strength of a response nobody checked.
 *
 * Its own history is the reason it is a named function with tests rather than a
 * regex inline in a script. It shipped as:
 *
 *     /<urlset[\\s>]/
 *
 * which looks like "urlset followed by whitespace or >" and is not. Inside a
 * regular expression literal `\\` is an escaped backslash, so the character
 * class was {backslash, "s", ">"} -- it matched a bare `<urlset>` and nothing
 * else. Next renders `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
 * with a space after the tag name, so the guard rejected every real sitemap and
 * refused to submit anything, permanently, while reading like caution.
 *
 * A guard that always fails is worse than no guard: it never fires an alarm, it
 * just quietly does nothing, and the thing it was protecting silently never
 * happens.
 */

/**
 * True when the body opens a sitemap URL set.
 *
 * Matches the tag name followed by whitespace (attributes to come) or `>` (no
 * attributes), so `<urlsetfoo>` is correctly rejected. Deliberately not a full
 * XML parse: the question is "did we get a sitemap or something else", and a
 * parser would add a dependency and new failure modes to answer it.
 */
export function looksLikeSitemapUrlSet(body: string): boolean {
  return /<urlset[\s>]/.test(body);
}
