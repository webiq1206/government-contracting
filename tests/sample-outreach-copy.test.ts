import { expect, it } from "vitest";
import { sampleOutreachCopy } from "@/lib/domain/sample-outreach-copy";
import { DEFAULT_TEMPLATES } from "@/db/seedData";
import { isEditableTemplateSlug } from "@/lib/domain/template-slugs";

it("adjusts only the sample copy of the standard attachment introduction", () => {
  const body = "Please review the complete scope, requirements, and attached bid documents.\nReply by {{quote_due_date}}.";
  expect(sampleOutreachCopy(body)).toBe("Please review the sample scope and requirements below. No bid documents are attached to this delivery test.\nReply by {{quote_due_date}}.");
  expect(body).toContain("attached bid documents");
});
it("preserves custom wording rather than broadly rewriting attachment or commitment terms", () => {
  const body = "No attachments are included. Please review the project summary; no quote is requested.";
  expect(sampleOutreachCopy(body)).toBe(body);
});
it.each(DEFAULT_TEMPLATES.filter(template => isEditableTemplateSlug(template.slug)))(
  "does not invent attachments or an original thread in the built-in $slug sample", template => {
    const result = sampleOutreachCopy(template.body);
    expect(result).toContain("sample scope and requirements");
    expect(result).not.toContain("attached bid documents");
    expect(result).not.toContain("attached to this email");
    expect(result).not.toContain("original message below");
  }
);
