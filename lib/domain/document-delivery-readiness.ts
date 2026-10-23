/** Recipient document access is a separate, deferred release. Source bytes
 * being readable does not prove a signed-out supplier can open our link.
 * No environment switch or caller-supplied flag grants that access here. */
export const DOCUMENT_LINK_DELIVERY_HOLD =
  "Recipient access to project document links is pending review. Outreach containing these links is held; the existing sign-in requirement is preserved.";

export function recipientDocumentLinkPending(value:string):boolean {
  try {return new URL(value,"https://relative.invalid").pathname.startsWith("/d/");}
  catch {return false;}
}

/** Also catches already composed/queued requests at the dispatch boundary. */
export function messageHasPendingDocumentLink(...bodies:(string|undefined)[]):boolean {
  return bodies.some(body=>{
    const text=body ?? "";
    const urls=text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
    return urls.some(recipientDocumentLinkPending) || /(?:^|[\s("'=])\/d\/[^\s<>"']+/i.test(text);
  });
}
