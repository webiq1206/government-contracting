import type { ReactNode } from "react";
import { can, permissionMessage, type Capability } from "@/lib/domain/roles";

/**
 * Show a control only to someone who could actually use it.
 *
 * The API refuses the request either way, so this is not the security boundary
 * and must never be treated as one. It is the difference between a product
 * that tells you where you stand and one that lets you fill in a form, press
 * Save, and read a 403 you had no way to anticipate. Offering an action that
 * cannot succeed is its own kind of lie.
 *
 * The default `fallback` is nothing, because most of the time the honest thing
 * is a quieter screen. `explain` is for the cases where the absence would
 * itself be confusing -- a settings page with no Save button reads as broken,
 * not as read-only -- and it names a role who can help, so the next step is a
 * conversation rather than a support ticket.
 */
export function Permitted({
  role,
  capability,
  children,
  fallback = null,
  explain = false,
}: {
  role: string | null | undefined;
  capability: Capability;
  children: ReactNode;
  fallback?: ReactNode;
  /** Render the reason in place of the control instead of showing nothing. */
  explain?: boolean;
}) {
  if (can(role, capability)) return <>{children}</>;
  if (explain) {
    return (
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
        {permissionMessage(role, capability)}
      </p>
    );
  }
  return <>{fallback}</>;
}

/**
 * A whole page the reader may look at but not change.
 *
 * Distinct from a permission BLOCK, which hides the page entirely. Most
 * settings screens are worth reading at any role -- knowing what the automation
 * rules are is part of understanding your own account -- so the honest shape is
 * the page, visible, with one banner saying it is read-only and who can change
 * it. Hiding it instead would answer a question nobody asked and raise one
 * nobody can answer.
 */
export function ReadOnlyBanner({
  role,
  capability,
  what,
}: {
  role: string | null | undefined;
  capability: Capability;
  /** "these rules", "this template", "the company profile". */
  what: string;
}) {
  if (can(role, capability)) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground"
    >
      <span className="font-medium text-foreground">You are reading {what}.</span>{" "}
      {permissionMessage(role, capability)}
    </div>
  );
}
