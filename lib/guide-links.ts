/**
 * Deep-link helpers so Today and other surfaces open Guide Me on the right step.
 */

export function withGuideQuery(
  href: string,
  opts?: { step?: string; focus?: string }
): string {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = base.indexOf("?");
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const existing = qIdx >= 0 ? base.slice(qIdx + 1) : "";
  const params = new URLSearchParams(existing);
  params.set("guide", "1");
  if (opts?.step) params.set("guideStep", opts.step);
  if (opts?.focus) params.set("guideFocus", opts.focus);
  const qs = params.toString();
  return `${path}?${qs}${hash}`;
}
