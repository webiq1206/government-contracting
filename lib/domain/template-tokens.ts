/**
 * The editor's view of the variable catalogue.
 *
 * This file used to BE the catalogue: a hand-maintained list of tokens with a
 * label and an example, entirely separate from the object literal the outreach
 * agent built at send time. Nothing checked that the two agreed, so the palette
 * could advertise a token that resolved to nothing, and the agent could fill a
 * token the palette never mentioned.
 *
 * It is now a view over lib/domain/outreach-vars, which both the editor and
 * every send path read. Adding a variable in one place adds it everywhere, and
 * a variable that stops resolving cannot keep appearing in the palette.
 *
 * The old names are kept because the editor, the preview API and several tests
 * import them, and renaming them would be churn for its own sake.
 */

import {
  OUTREACH_VARS,
  OUTREACH_VAR_SAMPLES,
  VAR_CATEGORIES,
  type VarCategory,
  type VarSpec,
} from "./outreach-vars";
import { buildOutreachSections } from "./outreach-sections";

export type TemplateTokenGroup = VarCategory;

export interface TemplateToken {
  key: string;
  label: string;
  description: string;
  example: string;
  group: TemplateTokenGroup;
  /** Where the value comes from, so an operator can go and check it. */
  dataSource: string;
  /** True when an email may not be sent while this is empty. */
  required: boolean;
  /** What happens when the value is missing. */
  fallback: string;
}

export const TEMPLATE_TOKEN_GROUPS: {
  id: TemplateTokenGroup;
  label: string;
  blurb: string;
}[] = VAR_CATEGORIES;

export const TEMPLATE_TOKENS: TemplateToken[] = OUTREACH_VARS.map((v: VarSpec) => ({
  key: v.key,
  label: v.label,
  description: v.description,
  example: v.example,
  group: v.category,
  dataSource: v.dataSource,
  required: v.required,
  fallback: v.fallback,
}));

/** Sample map for preview / test sends in the editor. */
export const TEMPLATE_TOKEN_SAMPLES: Record<string, string> = OUTREACH_VAR_SAMPLES;

/** Filenames shown in the editor preview details footer (not sent as bytes). */
export const TEMPLATE_PREVIEW_ATTACHMENTS = [
  "Statement of Work.pdf",
  "Wage Determination.pdf",
];

/**
 * The sections the Outreach agent appends beneath the template body.
 *
 * Built from the same sample values the palette advertises and by the same
 * function the send path calls, so what an operator sees while editing is the
 * shape a subcontractor receives. Previewing a different structure from the one
 * that ships would make the editor lie in the one place it must not.
 */
export function previewBriefSections() {
  return buildOutreachSections({
    vars: TEMPLATE_TOKEN_SAMPLES,
    scopeBoundary: "Please price the HVAC scope only.",
    attachedNames: TEMPLATE_PREVIEW_ATTACHMENTS,
    links: [],
  });
}
