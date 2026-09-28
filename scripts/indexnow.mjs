// This ownership token is intentionally public, served at the site root.
const key = "640f9f9b50947150afc17ad11dff1567";
const origin = "https://brostco.com";
const keyLocation = `${origin}/${key}.txt`;
const dryRun = process.argv.includes("--dry-run");
const explicitUrls = process.argv.slice(2).filter(arg => arg !== "--dry-run");

async function get(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const sitemap = await get(`${origin}/sitemap.xml`);
  if (!/<urlset[\s>]/.test(sitemap)) throw new Error("Expected a sitemap URL set");
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match =>
    match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  );
  const urlList = [...new Set(explicitUrls.length ? explicitUrls : listed)];
  if (!urlList.length || urlList.length > 10000) throw new Error("Expected 1 to 10,000 public URLs");
  for (const value of urlList) {
    const url = new URL(value);
    if (url.origin !== origin || url.search || url.hash || url.username || url.password || !listed.includes(value)) {
      throw new Error(`URL is not a canonical public sitemap URL: ${value}`);
    }
  }
  if ((await get(keyLocation)).trim() !== key) throw new Error("Live IndexNow ownership key does not match");
  const payload = { host: "brostco.com", key, keyLocation, urlList };
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...payload }, null, 2));
    return;
  }
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (![200, 202].includes(response.status)) {
    throw new Error(`IndexNow returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  console.log(`IndexNow accepted ${urlList.length} URLs (HTTP ${response.status}). Indexing is not guaranteed.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
