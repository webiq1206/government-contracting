// Reuse the Open Graph image for Twitter/X cards.
export const runtime = "nodejs";
// Route segment config is not inherited through a re-export, so this repeats the
// force-dynamic set on ./opengraph-image (see the note there).
export const dynamic = "force-dynamic";
export { alt, size, contentType, default } from "./opengraph-image";
