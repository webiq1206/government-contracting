import { parseHTML } from "linkedom";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
if (
  process.env.BROSTCO_LOCAL_QA !== "1" ||
  process.env.PGDATABASE !== "brostco_audit"
)
  throw new Error("Only disposable UI fixtures may be exported.");
const results = JSON.parse(
  readFileSync("artifacts/redesign/route-render-results.json", "utf8"),
);
mkdirSync(".qa-screens", { recursive: true });
for (const result of results) {
  if (!result.html || result.route.startsWith("/vendor")) continue;
  const raw = readFileSync(
    join("artifacts/redesign/server-renders", result.html),
    "utf8",
  );
  const { document } = parseHTML(raw);
  for (const script of [...document.querySelectorAll("script")]) {
    for (const match of script.textContent.matchAll(
      /\$(RC|RS)\("([BS]:[a-f0-9]+)","([SP]:[a-f0-9]+)"\)/g,
    )) {
      const [, kind, a, b] = match;
      const dest = document.getElementById(kind === "RC" ? a : b);
      const source = document.getElementById(kind === "RC" ? b : a);
      if (!dest || !source) continue;
      if (kind === "RC") {
        let next = dest.nextSibling,
          depth = 0;
        while (next) {
          let after = next.nextSibling;
          if (next.nodeType === 8) {
            if (next.data === "/$") {
              if (depth === 0) break;
              depth--;
            } else if (next.data.startsWith("$")) depth++;
          }
          next.remove();
          next = after;
        }
      }
      while (source.firstChild)
        dest.parentNode.insertBefore(source.firstChild, dest);
      dest.remove();
      source.remove();
    }
  }
  for (const node of [
    ...document.querySelectorAll(
      'script,link[as="script"],meta[http-equiv="refresh"]',
    ),
  ])
    node.remove();
  for (const link of [...document.querySelectorAll('link[rel="stylesheet"]')]) {
    const href = link.getAttribute("href");
    if (!href.startsWith("/_next/")) continue;
    let css = readFileSync(
      ".next-release/" + href.replace("/_next/", ""),
      "utf8",
    );
    css = css.replace(/url\(([^)]+)\)/g, (all, url) => {
      const val = url.replace(/["']/g, "");
      if (!val.startsWith("../media/")) return all;
      try {
        return `url(data:font/woff2;base64,${readFileSync(".next-release/static/media/" + val.split("/").at(-1)).toString("base64")})`;
      } catch {
        return all;
      }
    });
    const style = document.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
  }
  // No executable product code or private API access in this fixture-only frame.
  for (const node of document.querySelectorAll("[href],[action]")) {
    const key = node.hasAttribute("href") ? "href" : "action";
    if (node.getAttribute(key)?.startsWith("/")) node.setAttribute(key, "#");
  }
  const name =
    result.file === "app/page.tsx"
      ? "landing"
      : result.file
          .replace(/^app\//, "")
          .replace(/\([^/]+\)\//g, "")
          .replace(/\/page.tsx$/, "")
          .replace(/[\[\]]/g, "")
          .replaceAll("/", "-");
  writeFileSync(".qa-screens/" + name + ".html", document.toString());
}
