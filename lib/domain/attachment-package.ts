/**
 * Whether the documents on a quote request are actually usable.
 *
 * The gatherer's job is to find files and fit them under the provider's size
 * limit. It has no opinion on whether what it found is any good, and its
 * failure mode is silence: a zero-byte download is skipped with `continue`, a
 * file called "attachment.pdf" is attached under that name, and an encrypted
 * PDF is sent to a subcontractor who cannot open it. In all three cases the
 * email goes out looking complete, and the first anyone hears about it is a
 * reply asking for the drawings, or no reply at all.
 *
 * This inspects the package that was actually assembled and reports what is
 * wrong with it, separating the problems that should stop a send from the ones
 * an operator merely needs to know about.
 *
 * The distinction that matters: a subcontractor cannot tell a document that
 * was not sent from one that does not exist. So a file we know about and
 * failed to deliver is a blocking problem, while a solicitation that genuinely
 * has no drawings is not a problem at all.
 *
 * Pure: takes an assembled package, returns findings. No storage, no network.
 */

export interface PackageFile {
  filename: string;
  /** Bytes, when they were downloaded. Absent for link-only entries. */
  content?: Buffer | Uint8Array | string;
  mime?: string | null;
}

export interface PackageLink {
  name: string;
  url: string;
}

export type PackageProblemKind =
  | "empty_file"
  | "corrupt_file"
  | "password_protected"
  | "generic_filename"
  | "duplicate"
  | "download_failed"
  | "nothing_delivered"
  | "superseded_only";

export interface PackageProblem {
  kind: PackageProblemKind;
  /** The file it concerns, when it concerns one. */
  filename?: string;
  message: string;
  /** True when this should stop the send. */
  blocking: boolean;
}

/**
 * Names that tell the recipient nothing.
 *
 * A subcontractor with six attachments called "document.pdf", "attachment.pdf"
 * and "file1.pdf" has to open all six to find the drawings, and will open
 * none. These come from SAM's own downloads and from storage layers that lost
 * the original name.
 */
const GENERIC_NAME_RE =
  /^(attachment|document|file|download|untitled|scan|image|doc|noname|unnamed|tmp|temp)[\s_-]*\d*\.[a-z0-9]{2,5}$/i;

/** Leading bytes that say what a file really is, whatever it is called. */
const MAGIC: { mime: RegExp; magic: string; label: string }[] = [
  { mime: /pdf/i, magic: "%PDF-", label: "PDF" },
  // DOCX/XLSX/PPTX are zip containers.
  { mime: /(word|excel|powerpoint|openxmlformats|zip)/i, magic: "PK", label: "Office or zip" },
];

function head(content: PackageFile["content"], n: number): string {
  if (content == null) return "";
  if (typeof content === "string") return content.slice(0, n);
  /*
   * subarray, not Buffer.from(content.buffer): a Buffer is a VIEW onto a
   * possibly larger ArrayBuffer, so reading the underlying buffer from offset
   * zero returns whatever else is pooled there. Every magic-byte check read
   * the wrong bytes and declared valid PDFs corrupt.
   */
  return Buffer.from(content).subarray(0, n).toString("latin1");
}

function byteLength(content: PackageFile["content"]): number {
  if (content == null) return -1; // unknown, not zero
  if (typeof content === "string") return content.length;
  return content.length;
}

/** A PDF that will ask the recipient for a password. */
export function looksPasswordProtected(file: PackageFile): boolean {
  if (!/pdf/i.test(file.mime ?? "") && !/\.pdf$/i.test(file.filename)) return false;
  const text = head(file.content, 4096);
  if (!text) return false;
  /*
   * /Encrypt in the trailer is how an encrypted PDF declares itself. Read from
   * the tail as well as the head, because the trailer is at the end; callers
   * that only hold a prefix will simply not match, which is the safe direction
   * to be wrong in.
   */
  return /\/Encrypt\b/.test(text);
}

/** Does the file's content agree with what its name and type claim? */
export function looksCorrupt(file: PackageFile): boolean {
  const bytes = byteLength(file.content);
  if (bytes < 0) return false; // not downloaded here; nothing to judge
  const text = head(file.content, 8);
  for (const m of MAGIC) {
    const claims = m.mime.test(file.mime ?? "") || new RegExp(`\\.${m.label === "PDF" ? "pdf" : "(docx|xlsx|pptx|zip)"}$`, "i").test(file.filename);
    if (claims) return !text.startsWith(m.magic);
  }
  return false;
}

export function looksGenericName(filename: string): boolean {
  return GENERIC_NAME_RE.test(filename.trim());
}

/** Two names that differ only in case, spacing or punctuation. */
function nameKey(filename: string): string {
  return filename.toLowerCase().replace(/[^a-z0-9.]+/g, "");
}

/**
 * Amendment numbering, so the newest version can be preferred.
 *
 * Returns null for a document that is not an amendment of anything, which is
 * most of them.
 */
export function amendmentOf(
  filename: string
): { base: string; number: number } | null {
  const m = filename.match(
    /^(.*?)[\s_-]*(?:amend(?:ed|ment)?|amd|rev(?:ision|ised)?)[\s_.-]*(\d+)?\b(.*)$/i
  );
  if (!m) return null;
  const base = (m[1] || m[3] || filename).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return { base: base || nameKey(filename), number: m[2] ? Number(m[2]) : 1 };
}

export interface PackageAssessment {
  problems: PackageProblem[];
  /** False when anything blocking was found. */
  ok: boolean;
  /** Names as the recipient will see them, for the Documents section. */
  deliveredNames: string[];
}

export function assessAttachmentPackage(input: {
  files: PackageFile[];
  links: PackageLink[];
  /** True when this solicitation has documents that ought to be included. */
  expected: boolean;
  /**
   * Documents we know about but could not deliver at all.
   *
   * Distinct from links: a link is still delivery. These are files the
   * gatherer failed to download AND failed to link, and the recipient has no
   * way to know they exist.
   */
  undelivered?: { name: string; reason: string }[];
}): PackageAssessment {
  const problems: PackageProblem[] = [];
  const deliveredNames: string[] = [];

  const seenNames = new Set<string>();
  for (const file of input.files) {
    const name = file.filename?.trim() || "";
    if (!name) continue;

    const key = nameKey(name);
    if (seenNames.has(key)) {
      /*
       * Blocking, because a duplicate is nearly always the same document
       * reached by two paths, and an email carrying "Drawings.pdf" twice
       * makes a subcontractor check whether they differ.
       */
      problems.push({
        kind: "duplicate",
        filename: name,
        message: `"${name}" is attached more than once.`,
        blocking: true,
      });
      continue;
    }
    seenNames.add(key);

    const bytes = byteLength(file.content);
    if (bytes === 0) {
      problems.push({
        kind: "empty_file",
        filename: name,
        message: `"${name}" is empty, so it would arrive as a zero-byte file the subcontractor cannot open.`,
        blocking: true,
      });
      continue;
    }
    if (looksCorrupt(file)) {
      problems.push({
        kind: "corrupt_file",
        filename: name,
        message: `"${name}" does not contain what its file type says it does, so it will not open.`,
        blocking: true,
      });
      continue;
    }
    if (looksPasswordProtected(file)) {
      problems.push({
        kind: "password_protected",
        filename: name,
        message: `"${name}" is password protected. The subcontractor will be asked for a password nobody has given them.`,
        blocking: true,
      });
      continue;
    }
    if (looksGenericName(name)) {
      /*
       * Not blocking. The document is intact and readable, and holding a whole
       * quote request over a bad filename would cost more than it saves. But a
       * package of "attachment.pdf" and "document.pdf" gets opened by nobody.
       */
      problems.push({
        kind: "generic_filename",
        filename: name,
        message: `"${name}" does not say what it is, so a subcontractor cannot tell which document to open first.`,
        blocking: false,
      });
    }

    deliveredNames.push(name);
  }

  for (const link of input.links) {
    const key = nameKey(link.name);
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    deliveredNames.push(link.name);
  }

  for (const missing of input.undelivered ?? []) {
    problems.push({
      kind: "download_failed",
      filename: missing.name,
      message: `"${missing.name}" could not be included (${missing.reason}). A subcontractor cannot tell a document that was not sent from one that does not exist.`,
      blocking: true,
    });
  }

  /*
   * Superseded-only: an amendment arrived but the document it amends did not,
   * or vice versa where the older version is all we have.
   *
   * Only the second is blocking. Pricing against a superseded drawing is the
   * expensive mistake; having the amendment without the original is merely
   * inconvenient, since the amendment usually restates what changed.
   */
  const byBase = new Map<string, number[]>();
  for (const name of deliveredNames) {
    const a = amendmentOf(name);
    if (!a) continue;
    byBase.set(a.base, [...(byBase.get(a.base) ?? []), a.number]);
  }
  for (const [, numbers] of byBase) {
    if (numbers.length > 1) {
      // Several revisions of one document: fine, and often required, but the
      // operator should know the recipient has to work out which governs.
      problems.push({
        kind: "superseded_only",
        message: `More than one revision of the same document is attached (${numbers
          .sort((a, b) => a - b)
          .map((n) => `rev ${n}`)
          .join(", ")}). Confirm the subcontractor can tell which one governs.`,
        blocking: false,
      });
    }
  }

  if (input.expected && deliveredNames.length === 0) {
    problems.push({
      kind: "nothing_delivered",
      message:
        "This solicitation has documents but none reached the email, so the subcontractor would be pricing blind.",
      blocking: true,
    });
  }

  return {
    problems,
    ok: !problems.some((p) => p.blocking),
    deliveredNames,
  };
}

/** One line per blocking problem, for the agent log and the operator. */
export function describePackageProblems(problems: PackageProblem[]): string {
  return problems
    .filter((p) => p.blocking)
    .map((p) => p.message)
    .join(" ");
}
