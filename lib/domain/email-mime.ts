/** Encoding for RFC 5322 headers and RFC 2045 body parts. */
export function singleMailbox(value: string): string | null {
  if (/[\r\n\x00-\x1f\x7f]/.test(value)) return null;
  const raw = value.trim();
  const match = raw.match(/^(?:[^<>]*)<([^<>]+)>$/);
  const address = (match ? match[1] : raw).trim();
  return /^[^\s<>@,;:"\\]+@[^\s<>@,;:"\\]+\.[^\s<>@,;:"\\]+$/.test(address)
    ? address : null;
}

export function mimeBase64(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export function attachmentFilename(value: string): string {
  const encoded = encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  if (encoded.length <= 60) return `filename*=UTF-8''${encoded}`;
  const chunks: string[] = [];
  let current = "";
  for (const piece of encoded.match(/%[0-9a-f]{2}|./gi) ?? []) {
    if (current.length + piece.length > 60) { chunks.push(current); current = ""; }
    current += piece;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, i) => `filename*${i}*=${i === 0 ? "UTF-8''" : ""}${chunk}`).join(";\r\n ");
}

/** Split on Unicode code points so a folded encoded word never splits UTF-8. */
export function encodedHeader(value: string): string {
  const clean = value.replace(/[\r\n\x00-\x1f\x7f]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean) && clean.length <= 65) return clean;
  const chunks: string[] = [];
  let current = "";
  for (const point of clean) {
    if (Buffer.byteLength(current + point) > 42) {
      chunks.push(current);
      current = "";
    }
    current += point;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => `=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`).join("\r\n ");
}

export function senderHeader(value: string): string {
  const address = singleMailbox(value);
  if (!address) throw new Error("A single valid sending address is required.");
  const name = value.includes("<") ? value.slice(0, value.lastIndexOf("<")).trim().replace(/^"(.*)"$/, "$1") : "";
  if (!name) return address;
  const encoded = encodedHeader(name);
  const display = encoded.startsWith("=?") ? encoded : `"${encoded.replace(/["\\]/g, "\\$&")}"`;
  return `${display} <${address}>`;
}
