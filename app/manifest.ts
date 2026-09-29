import type { MetadataRoute } from "next";

/**
 * Web app manifest: makes BrostCo installable to a phone's home screen so the
 * Call Queue and Today work like an app in the field (standalone window, own
 * icon), no store, no build step, just "Add to Home Screen".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BrostCo",
    short_name: "BrostCo",
    description:
      "AI for government contractors: opportunities found and scored, subcontractors coordinated, and bids prepared for your review.",
    start_url: "/today",
    display: "standalone",
    background_color: "#F7F5F3",
    theme_color: "#171713",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
