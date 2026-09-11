import { readFile } from "node:fs/promises";
import path from "node:path";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.BROSTCO_LOCAL_QA !== "1"
  )
    return new Response("Not found", { status: 404 });
  const query = new URL(request.url).searchParams;
  const name = query.get("page") || "today";
  if (!/^[a-z0-9-]+$/.test(name))
    return new Response("Not found", { status: 404 });
  const width = Math.min(
    1440,
    Math.max(320, Number(query.get("width")) || 1280),
  );
  let html: string;
  try {
    html = await readFile(
      path.join(process.cwd(), ".qa-screens", name + ".html"),
      "utf8",
    );
  } catch {
    return new Response("Fixture not available", { status: 404 });
  }
  if (query.get("dark") === "1")
    html = html.replace('<html lang="en"', '<html class="dark" lang="en"');
  const escaped = html
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
  return new Response(
    `<!doctype html><html><head><title>BrostCo sample layout: ${name}</title><style>html,body{margin:0;background:#f6f8fb}iframe{display:block;border:0}</style></head><body><iframe title="BrostCo sample layout" sandbox="allow-same-origin" width="${width}" height="900" srcdoc="${escaped}"></iframe></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
