/**
 * Which provider and model a call should use, and where it goes if that
 * provider refuses.
 *
 * Pure. The decision depends on three things and nothing else: how hard the
 * task is, which provider keys THIS organization actually holds, and the
 * operator's tier preferences from the environment. Reading credentials and
 * making requests happens in lib/ai/claude.ts; keeping the decision here
 * means it can be tested without a database or a network.
 *
 * Two tiers, deliberately not more:
 *
 *   routine   high-volume, lower-stakes work (scoring, outreach, call prep,
 *             reply reading, digests). Cheap and fast matters most.
 *   complex   the bid-critical path (Solicitation Analyst, Learning Loop,
 *             Compliance Auditor, reading scanned PDFs), where a missed
 *             requirement costs a bid. Accuracy matters most.
 *
 * A caller that names a model outright is expressing a tier preference, not
 * a hard pin: if that model's provider has no key for the organization, the
 * other provider serves the same tier rather than the step being skipped.
 */

export type AiProvider = "Anthropic" | "OpenAI";
export type AiTier = "routine" | "complex";
export type AiEnvKey = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";

export interface AiRoute {
  provider: AiProvider;
  model: string;
  envKey: AiEnvKey;
  /**
   * Whether the ledger should treat this as complex work. Any model other
   * than the provider's routine default counts, which is how an operator's
   * "pause complex AI work" cost control keeps its meaning across providers.
   */
  complex: boolean;
}

export interface RoutingConfig {
  anthropic: { model: string; modelSmart: string };
  openai: { model: string; modelSmart: string };
  /** Preferred provider for each tier. Availability still wins. */
  routineProvider: AiProvider;
  complexProvider: AiProvider;
  /** Master switch for cross-provider fallback. */
  fallback: boolean;
}

export interface RouteRequest {
  complexity?: AiTier;
  /** An explicit model id, e.g. config.claude.modelSmart or "gpt-5.6-luna". */
  model?: string;
  /** Set false to refuse a fallback for this call (provider self-tests). */
  fallback?: boolean;
  available: Record<AiProvider, boolean>;
  cfg: RoutingConfig;
}

export interface RoutePlan {
  primary: AiRoute;
  fallback: AiRoute | null;
}

export const ENV_KEY_FOR: Record<AiProvider, AiEnvKey> = {
  Anthropic: "ANTHROPIC_API_KEY",
  OpenAI: "OPENAI_API_KEY",
};

export const PROVIDER_FOR_KEY: Record<AiEnvKey, AiProvider> = {
  ANTHROPIC_API_KEY: "Anthropic",
  OPENAI_API_KEY: "OpenAI",
};

/** Which provider serves a model id. Unknown ids stay with Anthropic, the original provider. */
export function providerForModel(model: string): AiProvider {
  return /^(gpt-|o\d|chatgpt-|codex-)/i.test(model.trim()) ? "OpenAI" : "Anthropic";
}

export function otherProvider(p: AiProvider): AiProvider {
  return p === "Anthropic" ? "OpenAI" : "Anthropic";
}

export function tierModel(cfg: RoutingConfig, provider: AiProvider, tier: AiTier): string {
  const models = provider === "Anthropic" ? cfg.anthropic : cfg.openai;
  return tier === "complex" ? models.modelSmart : models.model;
}

/** True when the model is anything but the provider's routine default. */
export function isComplexModel(cfg: RoutingConfig, provider: AiProvider, model: string): boolean {
  return model !== tierModel(cfg, provider, "routine");
}

/** Normalize an operator's provider preference; anything unrecognised keeps the default. */
export function parseProvider(value: string | undefined, fallback: AiProvider): AiProvider {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "openai" || v === "gpt") return "OpenAI";
  if (v === "anthropic" || v === "claude") return "Anthropic";
  return fallback;
}

function route(cfg: RoutingConfig, provider: AiProvider, model: string, tier: AiTier): AiRoute {
  return {
    provider,
    model,
    envKey: ENV_KEY_FOR[provider],
    complex: tier === "complex" || isComplexModel(cfg, provider, model),
  };
}

/**
 * Decide the primary route and, when another configured provider exists,
 * the fallback. Returns null when no provider has a key at all.
 */
export function chooseRoute(req: RouteRequest): RoutePlan | null {
  const { cfg, available } = req;
  const explicit = req.model?.trim() || undefined;
  const explicitProvider = explicit ? providerForModel(explicit) : null;

  const tier: AiTier =
    req.complexity ??
    (explicit && explicitProvider
      ? isComplexModel(cfg, explicitProvider, explicit)
        ? "complex"
        : "routine"
      : "routine");

  let primary: AiRoute | null = null;
  if (explicit && explicitProvider) {
    if (available[explicitProvider]) {
      primary = route(cfg, explicitProvider, explicit, tier);
    } else {
      const other = otherProvider(explicitProvider);
      if (available[other]) primary = route(cfg, other, tierModel(cfg, other, tier), tier);
    }
  } else {
    const preferred = tier === "complex" ? cfg.complexProvider : cfg.routineProvider;
    const chosen = available[preferred] ? preferred : available[otherProvider(preferred)] ? otherProvider(preferred) : null;
    if (chosen) primary = route(cfg, chosen, tierModel(cfg, chosen, tier), tier);
  }
  if (!primary) return null;

  const other = otherProvider(primary.provider);
  const fallback =
    req.fallback !== false && cfg.fallback && available[other]
      ? route(cfg, other, tierModel(cfg, other, tier), tier)
      : null;

  return { primary, fallback };
}
