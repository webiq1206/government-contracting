/**
 * Pure helpers for the email-template editor toolbar.
 * Highlight wraps each selected line (email clients cannot highlight across
 * newlines). Bullets skip {{questions}} because that token already expands
 * to a list.
 */

export function isListTokenLine(line: string): boolean {
  return /^\s*\{\{\s*questions\s*\}\}\s*$/i.test(line);
}

export function wrapSelection(
  current: string,
  start: number,
  end: number,
  before: string,
  after: string,
  emptyPlaceholder = "text"
): { next: string; selectStart: number; selectEnd: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  const selected = current.slice(from, to);
  const inner = selected.length > 0 ? selected : emptyPlaceholder;
  const next = current.slice(0, from) + before + inner + after + current.slice(to);
  const selectStart = from + before.length;
  const selectEnd = selectStart + inner.length;
  return { next, selectStart, selectEnd };
}

/**
 * Wrap a same-line selection as ==phrase==. When the selection spans
 * multiple lines, wrap each non-empty line independently so highlight
 * markers never straddle a newline (which the renderer cannot parse).
 * Leaves {{questions}} alone.
 */
export function wrapHighlightLines(
  current: string,
  start: number,
  end: number,
  emptyPlaceholder = "highlighted text"
): { next: string; selectStart: number; selectEnd: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));

  if (from === to) {
    return wrapSelection(current, from, to, "==", "==", emptyPlaceholder);
  }

  const selected = current.slice(from, to);
  if (!selected.includes("\n")) {
    if (isListTokenLine(selected.trim())) {
      return { next: current, selectStart: from, selectEnd: to };
    }
    return wrapSelection(current, from, to, "==", "==", emptyPlaceholder);
  }

  const lineStart = current.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lineEndIdx = current.indexOf("\n", to);
  const lineEnd = lineEndIdx === -1 ? current.length : lineEndIdx;
  const block = current.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const nextLines = lines.map((line) => {
    if (line.trim() === "" || isListTokenLine(line)) return line;
    if (/^==[^=\n]+==$/.test(line.trim())) return line;
    return `==${line}==`;
  });
  const replaced = nextLines.join("\n");
  const next = current.slice(0, lineStart) + replaced + current.slice(lineEnd);
  return {
    next,
    selectStart: lineStart,
    selectEnd: lineStart + replaced.length,
  };
}

/** Prefix each selected line with "- ", skipping {{questions}} and blanks. */
export function toggleBulletLines(
  current: string,
  start: number,
  end: number
): { next: string; selectStart: number; selectEnd: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  const lineStart = current.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lineEndIdx = current.indexOf("\n", to);
  const lineEnd = lineEndIdx === -1 ? current.length : lineEndIdx;
  const block = current.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const actionable = lines.filter((l) => l.trim() !== "" && !isListTokenLine(l));
  const allBulleted =
    actionable.length > 0 &&
    actionable.every((l) => /^\s*[-*•]\s+/.test(l));
  const nextLines = lines.map((l) => {
    if (l.trim() === "" || isListTokenLine(l)) return l;
    if (allBulleted) return l.replace(/^\s*[-*•]\s+/, "");
    if (/^\s*[-*•]\s+/.test(l)) return l;
    return `- ${l}`;
  });
  const replaced = nextLines.join("\n");
  const next = current.slice(0, lineStart) + replaced + current.slice(lineEnd);
  return {
    next,
    selectStart: lineStart,
    selectEnd: lineStart + replaced.length,
  };
}
