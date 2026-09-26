import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/analytics";
import { publicEventPayload } from "@/lib/domain/public-analytics";
import { consume, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const expected = new URL(process.env.APP_URL || req.url).origin;
  if (!origin || origin !== expected) return new NextResponse(null, { status: 403 });
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") return new NextResponse(null, { status: 204 });
  const rate = consume("marketing-events", clientIp(req), { limit: 60, windowMs: 60_000 });
  if (!rate.ok) return new NextResponse(null, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  const reader = req.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 400 });
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const payload = publicEventPayload(JSON.parse(text));
    if (!payload) return new NextResponse(null, { status: 400 });
    await trackEvent(payload);
    return new NextResponse(null, { status: 204 });
  } catch { return new NextResponse(null, { status: 400 }); }
}
