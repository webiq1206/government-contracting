import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
// Rendered per-request rather than prerendered at build. Next's bundled
// @vercel/og resolves its wasm/font assets with path.join() over a file:// URL,
// which only survives on POSIX, so prerendering this route breaks any build run
// from Windows. Social crawlers hit this a handful of times, so generating on
// demand costs nothing and keeps `npm run build` portable.
export const dynamic = "force-dynamic";
export const alt = "BROST CO, Autonomous Procurement Execution";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Open Graph / social sharing image (1200×630): the approved BROST CO wordmark
 * artwork (never re-typed, per the brand guide) on the warm light ground, with
 * a gold accent rule and charcoal supporting copy set in Inter.
 */
async function loadInter(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Inter:wght@500&display=swap",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    ).then((r) => r.text());
    const url = css.match(/src:\s*url\((https:[^)]+\.(?:woff2?|ttf))\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [inter, wordmark] = await Promise.all([
    loadInter(),
    readFile(path.join(process.cwd(), "public", "brand", "wordmark-dark.png")),
  ]);
  const wordmarkSrc = `data:image/png;base64,${wordmark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F5F3",
          color: "#242424",
          fontFamily: inter ? "Inter" : "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 12,
            fontWeight: 500,
            color: "#6B6560",
            textTransform: "uppercase",
          }}
        >
          Autonomous Procurement Execution
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={wordmarkSrc}
          alt="BROST CO"
          width={720}
          height={160}
          style={{ marginTop: 44, width: 720, height: 160, objectFit: "contain" }}
        />
        <div
          style={{
            marginTop: 44,
            width: 120,
            height: 3,
            background: "#B28F5D",
          }}
        />
        <div style={{ marginTop: 44, fontSize: 28, color: "#57524D" }}>
          Federal contracting, from posting to submission-ready bid.
        </div>
      </div>
    ),
    {
      ...size,
      fonts: inter
        ? [{ name: "Inter", data: inter, weight: 500, style: "normal" }]
        : undefined,
    }
  );
}
