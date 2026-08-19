import { redirect } from "next/navigation";

/**
 * Settings has tabs but no landing page of its own, so a bare /settings used
 * to 404 -- reachable by typing the URL, an old bookmark, or a trimmed link.
 * Send it to the first tab (the one the nav opens to) instead of a dead end.
 */
export default function SettingsIndex() {
  redirect("/settings/profile");
}
