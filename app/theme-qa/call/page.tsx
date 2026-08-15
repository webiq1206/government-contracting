import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CallPreview } from "./call-preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Call workspace lab",
  description: "Development-only check of the call guide slide-over.",
  robots: { index: false, follow: false },
};

/**
 * The call workspace, on a fixture card.
 *
 * The real slide-over only opens from the Call Queue, which needs a database
 * and a signed-in operator, so the one screen an operator works during a live
 * phone call is also the one hardest to look at. Dev only: 404 in production.
 */
export default function CallWorkspaceLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="min-h-screen bg-background">
      <CallPreview />
    </main>
  );
}
