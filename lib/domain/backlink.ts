/**
 * Backlink-opportunity qualification. Pure, deterministic, unit-tested. Turns the
 * raw metrics for a prospect (domain rating, topical relevance, estimated
 * traffic, spam score, indexing status, link type, opportunity type) into a
 * single 0-100 priority score + a tier, so the acquisition pipeline always works
 * the highest-value, safest opportunities first and rejects the spammy / weak /
 * off-topic ones outright. Quality over quantity: DR and topical relevance
 * dominate; spam, no-index, and off-topic are hard rejects.
 */

export type LinkType = "dofollow" | "nofollow" | "unknown";
export type OpportunityTier = "high" | "medium" | "low" | "reject";

export interface ProspectMetrics {
  dr?: number | null; // domain rating 0-100
  relevance?: number | null; // topical relevance 0-1
  traffic?: number | null; // estimated monthly organic visits
  spamScore?: number | null; // 0-100 (higher = spammier)
  indexed?: boolean | null; // indexed in Google
  linkType?: LinkType | null;
  opportunityType: string;
}

export interface Qualification {
  score: number; // 0-100 composite priority
  tier: OpportunityTier;
  reasons: string[];
}

// Hard-reject thresholds — protect the domain from low-quality / risky links.
const MIN_DR = 8; // below this the link barely moves authority
const MIN_RELEVANCE = 0.15; // off-topic links look manipulative and add little
const MAX_SPAM = 30; // above this, skip regardless of other metrics

// White-hat value multiplier per opportunity type. Higher = more authoritative /
// higher-ROI and lower-risk. Directories/citations are safe but lower authority.
const TYPE_VALUE: Record<string, number> = {
  competitor_gap: 1.0,
  resource_page: 1.0,
  broken_link: 1.0,
  unlinked_mention: 1.05, // genuine, easy, low-risk wins
  association: 0.95,
  partnership: 1.0,
  supplier: 0.95,
  guest_post: 0.9,
  haro: 1.0,
  directory: 0.7,
  local_citation: 0.7,
};

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function qualifyProspect(m: ProspectMetrics): Qualification {
  const reasons: string[] = [];

  // --- Hard rejects first. ---
  if (m.indexed === false) {
    return { score: 0, tier: "reject", reasons: ["Domain is not indexed in Google"] };
  }
  const spam = clamp(num(m.spamScore), 0, 100);
  if (m.spamScore != null && spam > MAX_SPAM) {
    return { score: 0, tier: "reject", reasons: [`Spam score ${spam} exceeds ${MAX_SPAM}`] };
  }
  const dr = clamp(num(m.dr), 0, 100);
  if (m.dr != null && dr < MIN_DR) {
    return { score: 0, tier: "reject", reasons: [`Domain rating ${dr} below minimum ${MIN_DR}`] };
  }
  const relevance = clamp(num(m.relevance), 0, 1);
  if (m.relevance != null && relevance < MIN_RELEVANCE) {
    return { score: 0, tier: "reject", reasons: ["Not topically relevant to our niche"] };
  }

  // --- Component scores (0-100). ---
  const drScore = dr;
  const relScore = relevance * 100;
  const traffic = Math.max(0, num(m.traffic));
  // Log scale: ~100k monthly visits saturates to 100; unknown traffic gets a
  // neutral-ish floor so a good DR + relevance prospect isn't buried.
  const trafficScore =
    traffic > 0 ? clamp((Math.log10(traffic + 1) / Math.log10(100_000)) * 100, 0, 100) : 30;

  // Weighted composite, quality-first (DR + relevance dominate).
  let score = drScore * 0.42 + relScore * 0.38 + trafficScore * 0.2;

  // Spam softens the score even below the hard-reject cutoff.
  if (spam > 0) score *= 1 - (spam / 100) * 0.5;

  // Link type: dofollow passes authority; nofollow still has value (traffic,
  // diversity) but far less; unknown is discounted modestly.
  const linkFactor = m.linkType === "nofollow" ? 0.6 : m.linkType === "dofollow" ? 1.0 : 0.85;
  score *= linkFactor;

  // Opportunity-type value.
  const typeFactor = TYPE_VALUE[m.opportunityType] ?? 0.9;
  score *= typeFactor;

  const final = clamp(Math.round(score), 0, 100);

  // Human-readable reasons.
  if (dr >= 50) reasons.push(`Strong authority (DR ${dr})`);
  else if (dr >= 25) reasons.push(`Moderate authority (DR ${dr})`);
  else reasons.push(`Low authority (DR ${dr})`);
  if (relevance >= 0.6) reasons.push("Highly relevant");
  else if (relevance >= 0.3) reasons.push("Somewhat relevant");
  if (m.linkType === "nofollow") reasons.push("Nofollow link");
  if (spam > 0) reasons.push(`Spam score ${spam}`);

  return { score: final, tier: tierFor(final), reasons };
}

/**
 * Cheap topical-relevance estimate for a referring domain, from its domain name
 * alone (all we can get from a bulk refdomains pull without paying to crawl each
 * page). Tokenizes the domain and measures overlap with our niche terms. This is
 * deliberately conservative: a name match is a strong positive signal, but the
 * absence of one is only weakly negative, so we floor the score at a neutral
 * value rather than hard-rejecting an unknown domain. A later enrichment pass
 * (fetching the page, or asking Claude) can overwrite this with a real relevance.
 */
export function domainNicheRelevance(domain: string, nicheTerms: string[]): number {
  const NEUTRAL = 0.4; // unknown but not disqualifying
  if (!domain || nicheTerms.length === 0) return NEUTRAL;
  const host = domain.toLowerCase().replace(/^www\./, "");
  // Split on dots and non-alphanumerics so "roofingpros-idaho.com" → roofing/pros/idaho.
  const haystack = host.replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, " ");
  let hits = 0;
  const terms = new Set<string>();
  for (const raw of nicheTerms) {
    for (const w of raw.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4) terms.add(w); // skip stopword-ish short tokens
    }
  }
  for (const t of terms) {
    if (haystack.includes(t)) hits++;
  }
  if (hits === 0) return NEUTRAL;
  // Each on-topic token in the domain name lifts relevance toward 1.
  return clamp(NEUTRAL + hits * 0.25, NEUTRAL, 1);
}

export function tierFor(score: number): OpportunityTier {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  if (score >= 22) return "low";
  return "reject";
}

export interface OutreachInput {
  domain: string;
  opportunityType: string;
  senderName: string; // person signing the email
  companyName: string;
  companyUrl: string;
  valueProp: string; // one line about what we do / can offer
}

export interface OutreachDraft {
  subject: string;
  body: string;
}

/**
 * White-hat outreach draft for a prospect. Deliberately honest and low-pressure:
 * no fake flattery, no "I noticed you linked to X" fabrication, no incentive
 * offers (paid links violate Google's guidelines). Every draft is reviewed and
 * approved by a human before anything is ever sent. Claude may refine this text,
 * but this template is the always-available fallback and the shape it must keep.
 */
export function outreachTemplate(input: OutreachInput): OutreachDraft {
  const { domain, opportunityType, senderName, companyName, companyUrl, valueProp } = input;
  const site = companyUrl.replace(/^https?:\/\//, "");
  const sign = `\n\nBest,\n${senderName}\n${companyName}\n${site}`;

  const byType: Record<string, OutreachDraft> = {
    resource_page: {
      subject: `A resource suggestion for ${domain}`,
      body: `Hi,\n\nI run ${companyName} (${site}). ${valueProp} I came across your resources page and thought our material might be a genuinely useful addition for your readers. If it's a fit, I'd be glad to share the specific link. Either way, thanks for putting the page together.${sign}`,
    },
    broken_link: {
      subject: `Broken link on ${domain}`,
      body: `Hi,\n\nWhile reading ${domain} I noticed a link that no longer resolves. I run ${companyName} (${site}) and we have a page covering the same topic that could work as a replacement if you'd like one. Happy to send the exact URL of the dead link and our alternative. Thanks either way.${sign}`,
    },
    unlinked_mention: {
      subject: `Thanks for the mention`,
      body: `Hi,\n\nThank you for mentioning ${companyName} on ${domain}. If it's appropriate, a link to ${site} would help readers find us directly. No worries at all if you'd rather not.${sign}`,
    },
    guest_post: {
      subject: `Contributing an article to ${domain}`,
      body: `Hi,\n\nI run ${companyName} (${site}). ${valueProp} I'd love to contribute an original, non-promotional article your readers would find useful. If you're open to guest contributions, I can send two or three topic ideas tailored to your audience.${sign}`,
    },
    competitor_gap: {
      subject: `Introducing ${companyName}`,
      body: `Hi,\n\nI run ${companyName} (${site}). ${valueProp} You link out to others in our space, so I wanted to introduce us in case we're a useful reference for your audience. No obligation at all, just putting us on your radar.${sign}`,
    },
  };

  return (
    byType[opportunityType] ?? {
      subject: `Introducing ${companyName}`,
      body: `Hi,\n\nI run ${companyName} (${site}). ${valueProp} I wanted to introduce us in case we're a useful reference for your audience on ${domain}. No obligation at all.${sign}`,
    }
  );
}

/** Sort prospects by priority (highest first); rejects sink to the bottom. */
export function prioritize<T extends { score: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score);
}
