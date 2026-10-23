/** Conservative, free classification of newly authored reply text. */
export type ReplyNoticeKind = "human" | "decline" | "opt_out" | "departed" | "away" | "automatic" | "prior_submission";

export function authoredReplyText(body: string): string {
  return (body ?? "").replace(/\r\n/g, "\n")
    .split(/\n\s*(?:On [\s\S]{0,240}?wrote:|[-_]{3,}\s*(?:Original|Forwarded) message|From:\s|>)/i)[0]!
    .replace(/\uFEFF/g, "").trim();
}

/** Matches the sender's instruction, never an unsubscribe footer in quoted mail. */
export function explicitOptOut(text: string): boolean {
  const authored = authoredReplyText(text);
  return /^\s*unsubscribe[.!]?\s*$/i.test(authored) || /\b(?:unsubscribe me|remove me from|take me off|stop (?:emailing|contacting|sending)|do not (?:email|contact) me|don'?t (?:email|contact) me|no longer wish to (?:receive|be contacted)|opt me out)\b/i.test(authored);
}

export function classifyReplyNotice(input: {
  body: string; subject?: string | null; autoSubmitted?: string | null;
  attachmentNames?: string[];
  requestedTrade?: string | null;
}): { kind: ReplyNoticeKind; authoredText: string; reason: string; needsReview?: boolean } {
  const text = authoredReplyText(input.body);
  const automatic = Boolean(input.autoSubmitted && input.autoSubmitted.toLowerCase() !== "no") ||
    /^\s*(?:automatic reply|auto(?:matic)?[- ]?(?:reply|response)|out of (?:the )?office)\b/i.test(input.subject ?? "");
  // Explicit stop instructions win over a decline; no acknowledgment is permitted.
  if (explicitOptOut(text)) return {kind:"opt_out", authoredText:text, reason:"The sender explicitly asked to stop email."};
  const substantive = (input.attachmentNames?.length ?? 0) > 0 || /(?:\$\s*\d|\b(?:our|my) (?:price|quote|estimate)\b|\b(?:attached|attachment)\b)/i.test(text);
  if (automatic && !substantive && /\b(?:i(?: am|['’]m)|[a-z][a-z .'-]{0,60} (?:is|does)) no longer (?:employed\b|work(?:ing)? (?:here|there)\b|(?:work(?:ing)? (?:at|for)|with) (?:the company|[a-z][a-z &'’.-]{1,80}(?:company|construction|electric|inc|llc|ltd))\b)/i.test(text)) {
    return {kind:"departed",authoredText:text,reason:"The automatic reply explicitly reports that this contact no longer works there."};
  }
  if (automatic && !substantive && /\b(?:out of (?:the )?office|away from (?:the )?office|on (?:vacation|leave)|return(?:ing)? (?:to|on)|respond (?:upon|on|when i) (?:my )?return)\b/i.test(text)) {
    return {kind:"away",authoredText:text,reason:"An automatic absence notice; no supplier decision or return date is inferred."};
  }
  const possibleContactChange = /\bno longer (?:work(?:ing)?|employed|with)\b/i.test(text);
  if (automatic) return {kind:"automatic",authoredText:text,needsReview:substantive || possibleContactChange,reason:substantive
    ? "An automatic message contains possible substantive content or attachments. Review it; no automatic reply or bid decision was made."
    : possibleContactChange ? "An automatic message mentions a possible role or work change. Review the wording; employment departure and contact eligibility have not been established."
    : "An automatic notice was saved. It is not a supplier decision."};
  if (/\b(?:we|i) (?:have )?already (?:submitted|sent|provided) (?:our|my|a|the) (?:quote|bid|proposal)\b/i.test(text)) {
    return {kind:"prior_submission",authoredText:text,needsReview:true,
      reason:"The supplier reports a prior submission. Verify its receipt, destination and scope with the opportunity owner before requesting pricing again; no quote or commitment was inferred."};
  }
  // A conditional/partial rejection, question, price or attachment needs the normal review path.
  const conflict = substantive || /\?|\b(?:if|unless|however|although|instead|except|but we can|but i can|(?<!not )interested in|can (?:offer|provide|quote)|(?:we|i) will (?:bid|quote|send)|unable to (?:confirm|decide))\b/i.test(text);
  // Match a complete refusal clause. "Pass your request to estimating" and
  // rejection of a named portion of the work require interpretation.
  const target = "(?:(?:this|the) (?:project|request|opportunity|solicitation|job|bid))";
  const end = "(?=[.!\\n]|$)";
  // Bare courtesy words can reject an offer of help while retaining the bid.
  // Only the entire minimal response is an unambiguous "No thanks" decline.
  const courtesyDecline = /^no (?:thank you|thanks)[.!]?$/i.test(text);
  const wholeServiceRefusal = /\b(?:we|i) (?:do not|don't|cannot|can't) (?:provide|perform|offer|handle) (?:(?:this|that|the requested) (?:service|work|scope)|these services)\s*(?=[.!\n]|$)/i.test(text);
  const normalize = (value:string) => value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  // An explicit negative capability clause can close the exact requested
  // trade, never an unrelated optional portion or a category keyword alone.
  const excluded = text.match(/\b(?:we|i) (?:only )?(?:provide|perform|offer|handle|do) [^.!?\n]{1,100}?[,;]?\s+(?:not|rather than) ([^.!?\n]+)/i)?.[1];
  const exactTradeRefusal = Boolean(excluded && input.requestedTrade &&
    normalize(excluded) === normalize(input.requestedTrade));
  const decline = courtesyDecline || wholeServiceRefusal || exactTradeRefusal || new RegExp(`\\b(?:(?:we(?:'re| are)|i(?:'m| am)) not interested(?: in ${target})?|we (?:will|must|have to) (?:pass|decline)(?: on ${target})?|we (?:are unable to|cannot|can't) (?:bid|quote) ${target})\\s*${end}`,"i").test(text);
  if (decline && !conflict) return {kind:"decline",authoredText:text,reason:"The person explicitly declined this request."};
  return {kind:"human",authoredText:text,reason:"Requires normal reply interpretation."};
}
