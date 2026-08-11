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
  "Brost Co, procurement execution software for federal services contractors";
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
 * Site-wide Open Graph image: approved light wordmark on the night ground,
 * matching the landing brand system. Logo is the hero signal.
 */
export default async function OpengraphImage() {
  const [didot, sans, mono, wordmark] = await Promise.all([
    loadFont("GFS Didot", 400),
    loadFont("DM Sans", 500),
    loadFont("JetBrains Mono", 500),
    readFile(path.join(process.cwd(), "public", "brand", "wordmark-light.png")),
  ]);
  const wordmarkSrc = `data:image/png;base64,${wordmark.toString("base64")}`;

  const fonts = [
    didot
      ? { name: "GFS Didot", data: didot, weight: 400 as const, style: "normal" as const }
      : null,
    sans
      ? { name: "DM Sans", data: sans, weight: 500 as const, style: "normal" as const }
      : null,
    mono
      ? {
          name: "JetBrains Mono",
          data: mono,
          weight: 500 as const,
          style: "normal" as const,
        }
      : null,
  ].filter(Boolean) as {
    name: string;
    data: ArrayBuffer;
    weight: 400 | 500;
    style: "normal";
  }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#090a09",
          color: "#f5f1e9",
          overflow: "hidden",
        }}
      >
        {/* Atmosphere: gold frame + soft orbs (no CSS gradients; Satori is brittle) */}
        <div
          style={{
            position: "absolute",
            inset: 28,
            border: "1px solid #c3a06b",
            opacity: 0.28,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 34,
            border: "1px solid #c3a06b",
            opacity: 0.1,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -40,
            top: -40,
            width: 360,
            height: 360,
            borderRadius: "50%",
            background: "#c3a06b",
            opacity: 0.14,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -100,
            bottom: -120,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: "#c3a06b",
            opacity: 0.08,
          }}
        />

        {/* Content */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "56px 72px 48px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: mono ? "JetBrains Mono" : "monospace",
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(245,241,233,0.52)",
            }}
          >
            <div
              style={{
                width: 28,
                height: 1,
                background: "#a68250",
              }}
            />
            Procurement execution
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wordmarkSrc}
              alt="BROST.co"
              width={780}
              height={178}
              style={{
                width: 780,
                height: 178,
                objectFit: "contain",
                objectPosition: "left center",
              }}
            />
            <div
              style={{
                marginTop: 28,
                width: 96,
                height: 2,
                background: "#c3a06b",
              }}
            />
            <div
              style={{
                marginTop: 28,
                maxWidth: 920,
                fontFamily: didot ? "GFS Didot" : "Georgia, serif",
                fontSize: 46,
                lineHeight: 1.12,
                letterSpacing: "-0.03em",
                color: "#f6f2eb",
              }}
            >
              Win the right government contracts. Stop managing the process by hand.
            </div>
            <div
              style={{
                marginTop: 18,
                maxWidth: 760,
                fontFamily: sans ? "DM Sans" : "sans-serif",
                fontSize: 22,
                lineHeight: 1.45,
                color: "rgba(245,241,233,0.58)",
              }}
            >
              Find, score, source, and prepare federal bids. You keep judgment and
              submission.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid rgba(255,255,255,0.12)",
              paddingTop: 22,
              fontFamily: mono ? "JetBrains Mono" : "monospace",
              fontSize: 14,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(245,241,233,0.38)",
            }}
          >
            <div style={{ display: "flex", gap: 28 }}>
              <span>Construction</span>
              <span>Facilities</span>
              <span>Professional services</span>
            </div>
            <div style={{ color: "#c3a06b", letterSpacing: "0.14em" }}>brostco.com</div>
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
