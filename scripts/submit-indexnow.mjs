/**
 * IndexNow URL submission script.
 * Fetches sitemap(s), extracts all URLs, filters to the configured host,
 * and submits them to the official IndexNow API.
 *
 * Run standalone:
 *   node scripts/submit-indexnow.mjs
 *
 * The deploy build runs this after `npm run build` (see build.sh).
 */

const HOST = "brostco.com";
const INDEXNOW_KEY = "1d3634e971bb42e7156d48902755ac5c";
const KEY_LOCATION = `https://${HOST}/1d3634e971bb42e7156d48902755ac5c.txt`;
const SITEMAP_URL = "https://brostco.com/sitemap.xml";
const INDEXNOW_API = "https://api.indexnow.org/indexnow";

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchXml(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

/**
 * @param {string} xmlText
 * @returns {string[]}
 */
function parseSitemap(xmlText) {
  const locs = xmlText.matchAll(/<loc>([^<]+)<\/loc>/g);
  return [...locs].map((m) => m[1].trim());
}

/**
 * @returns {Promise<string[]>}
 */
async function collectAllUrls() {
  const urls = [];
  const sitemapIndex = await fetchXml(SITEMAP_URL);
  const isSitemapIndex = sitemapIndex.includes("<sitemapindex");

  if (isSitemapIndex) {
    const sitemapLocs = parseSitemap(sitemapIndex);
    console.log(`Sitemap index: ${sitemapLocs.length} child sitemap(s)`);
    for (const childUrl of sitemapLocs) {
      const childXml = await fetchXml(childUrl);
      const childUrls = parseSitemap(childXml);
      console.log(`  ${childUrl} -> ${childUrls.length} URL(s)`);
      urls.push(...childUrls);
    }
  } else {
    const directUrls = parseSitemap(sitemapIndex);
    console.log(`Single sitemap: ${directUrls.length} URL(s)`);
    urls.push(...directUrls);
  }

  return urls;
}

/**
 * @returns {Promise<void>}
 */
async function verifyPreconditions() {
  const checks = [
    { url: SITEMAP_URL, label: "sitemap" },
    { url: `https://${HOST}/robots.txt`, label: "robots.txt" },
    { url: KEY_LOCATION, label: "key location" },
  ];

  let allPassed = true;
  for (const { url, label } of checks) {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`\u2705 ${label} (${url}) -> ${res.status}`);
    } else {
      console.log(`\u26a0 ${label} (${url}) -> ${res.status}`);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.log("\n\u26a0 Some preconditions are not yet live on the deployed site. This is expected on the first build after adding the key file.");
    console.log("\u26a0 Continuing with IndexNow submission anyway (the API may accept it; search engines will validate the key file after this deploy goes live).");
  }
}

/**
 * @param {string[]} urlList
 * @returns {Promise<Response>}
 */
async function submitIndexNow(urlList) {
  const body = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  };

  const res = await fetch(INDEXNOW_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  return res;
}

/**
 * Run the full IndexNow submission pipeline.
 * @returns {Promise<{submitted: number; status: number}>}
 */
export default async function submit() {
  console.log("=== IndexNow Submission ===\n");

  // Step 1: verify preconditions
  await verifyPreconditions();
  console.log();

  // Step 2: collect all URLs from sitemap
  const allUrls = await collectAllUrls();
  const hostUrls = allUrls.filter(
    (u) => new URL(u).hostname === HOST,
  );

  console.log(`\nTotal URLs found: ${allUrls.length}`);
  console.log(`Host URLs (${HOST}): ${hostUrls.length}`);

  if (hostUrls.length === 0) {
    console.log("No host URLs to submit. Exiting.");
    return { submitted: 0, status: 0 };
  }

  // Step 3: submit to IndexNow
  console.log(`\nSubmitting to ${INDEXNOW_API}...`);
  const res = await submitIndexNow(hostUrls);

  const resText = await res.text();
  console.log(`\nIndexNow response: ${res.status}`);
  if (resText) {
    console.log(`Response body: ${resText.slice(0, 500)}`);
  }

  if (res.ok || res.status === 202) {
    console.log(`\n\u2705 Submitted ${hostUrls.length} URL(s). IndexNow accepted (HTTP ${res.status}).`);
    return { submitted: hostUrls.length, status: res.status };
  } else {
    console.error(`\n\u274c IndexNow submission failed (HTTP ${res.status}).`);
    const error = new Error(`IndexNow submission failed (HTTP ${res.status})`);
    error.status = res.status;
    error.body = resText;
    throw error;
  }
}

async function main() {
  const result = await submit();
  console.log(`\nDone: ${result.submitted} URL(s) submitted.`);
}

main().catch((err) => {
  console.error("\nUnexpected error:", err.message);
  process.exit(1);
});
