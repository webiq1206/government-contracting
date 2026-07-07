import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "BROSTCO, Autonomous Procurement Execution";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Open Graph / social sharing image, the BROSTCO wordmark rendered as a real
 * PNG (1200×630) on the brand's cream ground: uppercase tracked eyebrow, the
 * serif wordmark, and the forest-green accent rule. The Cormorant Garamond
 * serif is loaded when reachable; if not, it degrades to the built-in font so
 * the image always renders.
 */
async function loadSerif(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&display=swap",
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
  const serif = await loadSerif();
  const serifFamily = serif ? "Cormorant Garamond" : "serif";

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
          background: "#fafaf9",
          color: "#111111",
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 12,
            fontWeight: 500,
            color: "#71717a",
            textTransform: "uppercase",
          }}
        >
          Autonomous Procurement Execution
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 168,
            lineHeight: 1,
            fontWeight: 600,
            letterSpacing: -2,
            fontFamily: serifFamily,
          }}
        >
          BROSTCO
        </div>
        <div
          style={{
            marginTop: 40,
            width: 120,
            height: 3,
            background: "#2d6a4f",
          }}
        />
        <div style={{ marginTop: 44, fontSize: 28, color: "#52525b" }}>
          Federal contracting, from posting to submission-ready bid.
        </div>
      </div>
    ),
    {
      ...size,
      fonts: serif
        ? [{ name: "Cormorant Garamond", data: serif, weight: 600, style: "normal" }]
        : undefined,
    }
  );
}
