/** Public network diagnostics only. No credentials, cookies, or response bodies. */
import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

const hosts = ["brostco.com", "www.brostco.com"];
const report = { checkedAt: new Date().toISOString(), vantage: "GitHub Actions or local runtime", hosts: [] };

async function dnsQuery(fn, host) {
  let timer;
  try {
    return await Promise.race([fn(host), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("DNS lookup exceeded 10 seconds")), 10_000);
    })]);
  } catch (error) { return { error: error.code ?? error.message }; }
  finally { clearTimeout(timer); }
}

function probe(host, path) {
  return new Promise(resolve => {
    const started = performance.now();
    const result = { path };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      result.elapsedMs = Math.round(performance.now() - started);
      resolve(result);
    };
    const request = https.get({ hostname: host, path, headers: { "User-Agent": "BrostCo-Owner-Connectivity-Check/1.0" } }, response => {
      result.status = response.statusCode;
      result.headersMs = Math.round(performance.now() - started);
      result.headers = Object.fromEntries(["server", "content-type", "location", "retry-after"].filter(key => response.headers[key]).map(key => [key, response.headers[key]]));
      // Do not collect bodies, cookies, or account data. No redirect following.
      response.destroy();
      finish();
    });
    const timer = setTimeout(() => {
      result.error = "No response headers within 20 seconds";
      request.destroy();
      finish();
    }, 20_000);
    request.on("socket", socket => {
      socket.on("connect", () => { result.connectedMs = Math.round(performance.now() - started); });
      socket.on("secureConnect", () => {
        const certificate = socket.getPeerCertificate();
        result.tls = { authorized: socket.authorized, protocol: socket.getProtocol(), issuer: certificate.issuer?.O, validTo: certificate.valid_to };
      });
    });
    request.on("error", error => { if (!finished) { result.error = error.code ?? error.message; finish(); } });
  });
}

for (const host of hosts) {
  const [a, aaaa, cname] = await Promise.all([dnsQuery(resolve4, host), dnsQuery(resolve6, host), dnsQuery(resolveCname, host)]);
  // The static asset separates a stalled application/data path from total
  // deployment unavailability. It needs neither authentication nor Postgres.
  const responses = await Promise.all(["/favicon.svg", "/", "/login", "/api/health"].map(path => probe(host, path)));
  report.hosts.push({ host, dns: { a, aaaa, cname }, responses });
}
const json = JSON.stringify(report, null, 2);
console.log(json);
if (process.env.CONNECTIVITY_REPORT_PATH) writeFileSync(process.env.CONNECTIVITY_REPORT_PATH, json + "\n");
// A diagnostic observation is not a software release gate.
