/**
 * The IndexNow key, and why it sits in the repository in plain sight.
 *
 * IndexNow is a push protocol: instead of waiting for a crawler to come back,
 * a site tells Bing, Yandex, Seznam and Naver that a URL changed, and they
 * fetch it within minutes rather than weeks. Ownership is proved by hosting the
 * key as a text file the search engine can fetch, so the key is public by
 * design -- it has to be, or the proof would not work.
 *
 * That makes it a capability, not a secret: it authorises "please recrawl a URL
 * on brostco.com" and nothing else. There is no account, no quota to protect,
 * and the worst a stranger can do with it is ask Bing to re-read a page of
 * ours. Keeping it in an environment variable would imply a confidentiality it
 * does not have, and would mean the key file silently 404s wherever that
 * variable is unset -- which breaks verification quietly, the failure mode this
 * whole programme exists to avoid.
 *
 * Rotate it by changing this value. The route below serves whatever is here, so
 * the file and the submissions can never disagree.
 */
export const INDEXNOW_KEY = "cbec6acc9a8075a879512f04dc6fa381";

/** Where the key is served. Sent as `keyLocation` so the filename can stay stable. */
export function indexNowKeyLocation(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/indexnow-key.txt`;
}
