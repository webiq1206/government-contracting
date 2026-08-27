/**
 * The outreach templates an operator may edit.
 *
 * One list, because there were four and three of them disagreed. The restore
 * route knew about two slugs while the save route knew about three, so
 * restoring an earlier version of the fallback follow-up body answered "not
 * found" for a template the same page had just let somebody edit.
 *
 * No imports on purpose: this is read by client components and by route
 * handlers, and a database import here would pull a connection into the
 * browser bundle.
 */
export const EDITABLE_TEMPLATE_SLUGS = [
  "template_1_outreach",
  "template_2_followup",
  // The fallback body, used only when the original thread cannot be replied
  // to. Editable for the same reason the others are: it is the email a
  // subcontractor reads.
  "template_2_followup_new_thread",
] as const;

export type EditableTemplateSlug = (typeof EDITABLE_TEMPLATE_SLUGS)[number];

export function isEditableTemplateSlug(slug: string): slug is EditableTemplateSlug {
  return (EDITABLE_TEMPLATE_SLUGS as readonly string[]).includes(slug);
}

/** The order they occur in, which is also the order they matter in. */
export function templateSlugOrder(slug: string): number {
  const i = (EDITABLE_TEMPLATE_SLUGS as readonly string[]).indexOf(slug);
  return i === -1 ? EDITABLE_TEMPLATE_SLUGS.length : i;
}
