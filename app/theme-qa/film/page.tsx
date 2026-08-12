import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilmCapture } from "@/components/marketing/film-capture";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Product film capture",
  robots: { index: false, follow: false },
};

/**
 * Capture stage for the landing product film. Rendered at a fixed 1920x1080
 * and driven frame by frame from scripts/render-product-film.mjs. Dev only.
 */
export default function FilmCapturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FilmCapture />;
}
