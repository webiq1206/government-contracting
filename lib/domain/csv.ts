/**
 * CSV, written so a spreadsheet reads back what we meant.
 *
 * The failure this exists to prevent is not a broken file, which someone would
 * notice. It is a file that opens cleanly and is wrong: a company called
 * "Rivera, Mechanical" silently becoming two columns, or a note containing a
 * newline pushing every later field onto the wrong row.
 */

/**
 * Quote a single field per RFC 4180.
 *
 * Anything containing a comma, a quote, or a line break is wrapped, and inner
 * quotes are doubled. Leading and trailing whitespace is preserved, because a
 * trailing space in a licence number is data, not formatting.
 */
export function csvField(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  /*
   * A field starting with =, +, - or @ is executed as a formula when the file
   * is opened in Excel or Sheets. That is a real attack -- a subcontractor
   * types a formula into a form, we export it, an operator opens it -- and
   * the standard mitigation is to prefix a tab so the cell is unambiguously
   * text. Excel shows the value; it does not run it.
   */
  const dangerous = /^[=+\-@\t\r]/.test(s);
  const guarded = dangerous ? `\t${s}` : s;
  /*
   * A guarded field is always quoted. The tab is only a reliable escape if it
   * survives the round trip, and an unquoted field with leading whitespace is
   * exactly what a lenient parser trims -- which would hand the formula back
   * unprotected.
   */
  if (dangerous || /[",\n\r\t]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/** One row, fields joined. */
export function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

/**
 * A complete CSV document.
 *
 * CRLF line endings and a UTF-8 BOM, both for the same reason: Excel on
 * Windows is the program these files are actually opened in, and without them
 * it mangles accented characters and, in some versions, the last column.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
