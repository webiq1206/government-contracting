/** Presentation only. Never changes the stored email or the reply sent to a provider. */
export function emailText(body: string | null): string {
  const text = body ?? "";
  // Plain text can contain addresses in angle brackets. Only strip known HTML tags.
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|tr)>/gi, "\n")
    .replace(/<\/?(?:html|body|head|meta|title|p|div|span|a|b|strong|i|em|u|table|tbody|thead|tr|td|th|ul|ol|li|blockquote|img|hr|font)\b[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function splitEmailBody(body: string | null) {
  const text = emailText(body);
  const lines = text.split("\n");
  const index = lines.findIndex((line, i) => {
    if (/^\s*On\s.+wrote:\s*$/i.test(line)) return true;
    if (/^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i.test(line)) return true;
    // Outlook headers need corroborating headers, not just a line saying "From:".
    if (/^\s*From:\s*\S/i.test(line)) {
      const headers = lines.slice(i + 1, i + 7).join("\n");
      return /^\s*(Sent|Date):/im.test(headers) && /^\s*(To|Subject):/im.test(headers);
    }
    // Only collapse a trailing quoted block. Preserve interleaved inline answers.
    return /^\s*>/.test(line) && lines.slice(i).every((rest) => !rest.trim() || /^\s*>/.test(rest));
  });
  // A quote-only email is still readable without opening a disclosure.
  if (index <= 0) return { current: text, quoted: "" };
  return { current: lines.slice(0, index).join("\n").trim(), quoted: lines.slice(index).join("\n").trim() };
}
