import { PUBLIC_ROUTES } from "./public-routes";

export const PUBLIC_EVENTS = ["marketing_page_view", "cta_click", "signup_started", "signup_error", "walkthrough_play"] as const;
export type PublicEvent = typeof PUBLIC_EVENTS[number];
const paths = new Set(PUBLIC_ROUTES.map((route) => route.path));

/** Anonymous endpoint accepts enumerated public facts, never form values. */
export function publicEventPayload(input: unknown): { event: PublicEvent; path: string; meta: Record<string, string> } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!PUBLIC_EVENTS.includes(value.event as PublicEvent) || typeof value.path !== "string" || !paths.has(value.path)) return null;
  const meta: Record<string, string> = {};
  if (typeof value.target === "string" && paths.has(value.target)) meta.target = value.target;
  if (value.location === "header" || value.location === "footer" || value.location === "content" || value.location === "form") meta.location = value.location;
  return { event: value.event as PublicEvent, path: value.path, meta };
}
