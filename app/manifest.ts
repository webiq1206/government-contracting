import type { MetadataRoute } from "next";

/**
 * Web app manifest: makes BROST CO installable to a phone's home screen so the
 * Call Queue and Today work like an app in the field (standalone window, own
 * icon), no store, no build step, just "Add to Home Screen".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BROST CO Procurement Execution",
    short_name: "BROST CO",
    description:
      "Autonomous government-contracting pipeline: opportunities found, scored, and worked automatically; you handle the calls and sign-offs.",
    start_url: "/today",
    display: "standalone",
    background_color: "#F7F5F3",
    theme_color: "#242424",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
