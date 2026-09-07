import { describe, expect, it } from "vitest";
import {
  attachmentIdentity,
  canonicalAttachmentUrl,
  mergeAttachmentReferences,
} from "@/lib/domain/attachment-identity";

describe("external attachment identity", () => {
  it("ignores rotated credentials and query ordering", () => {
    const oldUrl =
      "https://API.SAM.GOV/prod/file?noticeid=abc&api_key=old&part=2";
    const freshUrl =
      "https://api.sam.gov/prod/file?part=2&api_key=fresh&noticeid=abc";
    expect(canonicalAttachmentUrl(oldUrl)).not.toContain("api_key");
    expect(attachmentIdentity({ name: "attachment", url: oldUrl })).toBe(
      attachmentIdentity({ name: "attachment", url: freshUrl })
    );
  });

  it("keeps different document selectors distinct", () => {
    const a = attachmentIdentity({
      name: "attachment",
      url: "https://api.sam.gov/file?noticeid=abc&part=1",
    });
    const b = attachmentIdentity({
      name: "attachment",
      url: "https://api.sam.gov/file?noticeid=abc&part=2",
    });
    expect(a).not.toBe(b);
  });

  it("uses the storage path to distinguish uploaded files with the same display name", () => {
    expect(
      attachmentIdentity({ name: "attachment", storage_path: "opportunities/o1/a.pdf" })
    ).not.toBe(
      attachmentIdentity({ name: "attachment", storage_path: "opportunities/o1/b.pdf" })
    );
  });

  it("merges reordered links without changing first-seen order", () => {
    const first = [
      { name: "attachment", url: "https://sam.gov/file?id=a&api_key=old" },
      { name: "attachment", url: "https://sam.gov/file?id=b&api_key=old" },
    ];
    const merged = mergeAttachmentReferences(first, [
      { name: "attachment", url: "https://sam.gov/file?id=b&api_key=fresh" },
      { name: "attachment", url: "https://sam.gov/file?id=a&api_key=fresh" },
      { name: "attachment", url: "https://sam.gov/file?id=c&api_key=fresh" },
    ]);
    expect(merged.map((item) => new URL(item.url!).searchParams.get("id"))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(merged.every((item) => item.url?.includes("api_key=fresh"))).toBe(true);
  });

  it("removes duplicate references already stored on the opportunity", () => {
    const duplicate = {
      name: "attachment",
      url: "https://sam.gov/file?id=a&api_key=old",
    };
    expect(
      mergeAttachmentReferences([duplicate, duplicate], [
        { ...duplicate, url: "https://sam.gov/file?id=a&api_key=fresh" },
      ])
    ).toHaveLength(1);
  });
});
