import React from "react";
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
export const alt =
  "Brost Co, Automated Government Procurement Software";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(
  family: string,
  weight: number
): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
        family
      )}:wght@${weight}&display=swap`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    ).then((r) => r.text());
    const url = css.match(/src:\s*url\((https:[^)]+\.(?:woff2?|ttf))\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Site-wide Open Graph image: dark ground, white Brost Co wordmark centered,
 * product line underneath.
 */
export default async function OpengraphImage() {
  const [sans, wordmark] = await Promise.all([
    loadFont("DM Sans", 500),
    readFile(path.join(process.cwd(), "public", "brand", "wordmark-light.png")),
  ]);
  const wordmarkSrc = `data:image/png;base64,${wordmark.toString("base64")}`;

  const fonts = [
    sans
      ? { name: "DM Sans", data: sans, weight: 500 as const, style: "normal" as const }
      : null,
  ].filter(Boolean) as {
    name: string;
    data: ArrayBuffer;
    weight: 500;
    style: "normal";
  }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#090a09",
          color: "#f5f1e9",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 36,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={wordmarkSrc}
            alt="BROST.co"
            width={640}
            height={146}
            style={{
              width: 640,
              height: 146,
              objectFit: "contain",
            }}
          />
          <div
            style={{
              fontFamily: sans ? "DM Sans" : "sans-serif",
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(245,241,233,0.72)",
              textAlign: "center",
            }}
          >
            Automated Government Procurement Software
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
    }
  );
}
