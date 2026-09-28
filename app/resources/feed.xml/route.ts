import { resourceFeed } from "@/lib/marketing/feed";
export const dynamic = "force-dynamic";
export async function GET() {
  return new Response(resourceFeed(process.env.APP_URL || "https://brostco.com"), { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
