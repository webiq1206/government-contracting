import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilmCapture } from "@/components/marketing/film-capture";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Product film capture",
  robots: { index: false, follow: false },
};

const SHOTS = [
  "today",
  "pipeline",
  "opportunity",
  "attention",
  "coverage",
  "call",
  "quotes",
  "package",
  "submit",
  "close",
] as const;

export default function FilmCapturePage({
  searchParams,
}: {
  searchParams?: { shot?: string };
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const shot = searchParams?.shot ?? "today";
  if (!SHOTS.includes(shot as (typeof SHOTS)[number])) notFound();
  return <FilmCapture shot={shot} />;
}
