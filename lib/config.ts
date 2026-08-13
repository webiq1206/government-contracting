/**
 * Central runtime configuration. Secret-bearing fields are getters that read
 * process.env on every access, so UI-managed integration settings (hydrated
 * into process.env by lib/integration-settings.ts) take effect without a
 * restart. Applies sane defaults,
 * and exposes typed helpers. Nothing here throws at import time, the platform
 * must boot even with a partially-filled .env and degrade gracefully.
 */
import "./env";

function str(key: string, fallback = ""): string {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  // Treat an un-replaced `.env.example` placeholder (a bare <...> token) as
  // unset, so a forgotten field degrades gracefully (feature disabled + logged)
  // instead of firing a bogus credential at the API. Angle brackets never occur
  // in real secrets, so this can't strip a legitimate value. Note: a value like
  // "BROSTCO <alerts@brostco.com>" is NOT a bare token and is left intact.
  if (/^<[^>]*>$/.test(v.trim())) return fallback;
  return v;
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(key: string): string[] {
  return str(key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  env: str("NODE_ENV", "development"),
  isProd: str("NODE_ENV") === "production",
  appUrl: str("APP_URL", "http://localhost:3000"),
  port: Number(str("PORT", "3000")),

  database: {
    url: str("DATABASE_URL"),
  },

  auth: {
    // Session-signing + integration-encryption secret. Accept SESSION_SECRET as
    // a fallback so either common name works (Replit auto-generates
    // SESSION_SECRET; our docs use AUTH_SECRET). Getter so a value hydrated
    // later is picked up.
    get secret() {
      return str("AUTH_SECRET") || str("SESSION_SECRET") || "dev-insecure-secret-change-me";
    },
    // True when no real secret is set (still the public source default). Used
    // to disable the forgeable env-operator cookie path in production.
    get secretIsDefault() {
      return this.secret === "dev-insecure-secret-change-me";
    },
    operatorEmail: str("OPERATOR_EMAIL"),
    operatorPasswordHash: str("OPERATOR_PASSWORD_HASH"),
  },

  supabase: {
    get url() { return str("SUPABASE_URL"); },
    get serviceKey() { return str("SUPABASE_SERVICE_ROLE_KEY"); },
    bucket: str("SUPABASE_STORAGE_BUCKET", "brostco-documents"),
    get enabled() {
      return Boolean(this.url && this.serviceKey);
    },
  },

  claude: {
    get apiKey() { return str("ANTHROPIC_API_KEY"); },
    // Default tier, high-volume, lower-stakes agents (scoring, outreach, call
    // prep, sub-verify, digests). Fast and cheap.
    model: str("CLAUDE_MODEL", "claude-haiku-4-5"),
    // High-stakes tier, the bid-critical path where a missed requirement or a
    // fabricated fact costs a bid: the Solicitation Analyst (bid brief) and the
    // Learning Loop (rubric-weight analysis). Stronger model.
    modelSmart: str("CLAUDE_MODEL_SMART", "claude-sonnet-5"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  sam: {
    get apiKey() { return str("SAM_API_KEY"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  // Ahrefs API v3 — powers the autonomous Site Authority / backlink module
  // (authority snapshots, competitor referring-domain mining, backlink monitoring).
  ahrefs: {
    get apiKey() { return str("AHREFS_API_KEY"); },
    // The domain we're building authority for (our own site).
    get target() { return str("AHREFS_TARGET", "brostco.com"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  usaspending: {
    baseUrl: str("USASPENDING_BASE_URL", "https://api.usaspending.gov"),
  },

  bls: {
    get apiKey() { return str("BLS_API_KEY"); },
  },

  googleMaps: {
    get apiKey() { return str("GOOGLE_MAPS_API_KEY") || str("GOOGLE_PLACES_API_KEY"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  hunter: {
    get apiKey() { return str("HUNTER_API_KEY"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  gmail: {
    get clientId() { return str("GMAIL_CLIENT_ID"); },
    get clientSecret() { return str("GMAIL_CLIENT_SECRET"); },
    get refreshToken() { return str("GMAIL_REFRESH_TOKEN"); },
    get sender() { return str("GMAIL_SENDER"); },
    get redirectUri() {
      return `${config.appUrl}/api/integrations/gmail/callback`;
    },
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  twilio: {
    get accountSid() { return str("TWILIO_ACCOUNT_SID"); },
    get authToken() { return str("TWILIO_AUTH_TOKEN"); },
    get fromNumber() { return str("TWILIO_FROM_NUMBER"); },
    get alertTo() { return str("ALERT_SMS_TO"); },
    get enabled() {
      return Boolean(this.accountSid && this.authToken && this.fromNumber);
    },
  },

  resend: {
    get apiKey() { return str("RESEND_API_KEY"); },
    get from() { return str("RESEND_FROM", "BROSTCO <alerts@brostco.com>"); },
    /** From-address for subcontractor outreach sent via Resend. */
    get outreachFrom() { return str("RESEND_OUTREACH_FROM", "BROSTCO <info@brostco.com>"); },
    get digestTo() { return str("DIGEST_EMAIL_TO"); },
    /** Svix signing secret for the Resend inbound-email webhook (whsec_...). */
    get webhookSecret() { return str("RESEND_WEBHOOK_SECRET"); },
    get enabled() {
      return Boolean(this.apiKey);
    },
    /** True when replies to Resend-sent outreach can be captured automatically. */
    get inboundEnabled() {
      return Boolean(this.apiKey && this.webhookSecret);
    },
  },

  /**
   * The domain every tenant sends from until they verify their own. Owned and
   * DNS-authenticated by us, so a customer can send outreach on day one
   * without touching their registrar.
   */
  get platformSendingDomain() {
    return str("PLATFORM_SENDING_DOMAIN", "send.brostco.com");
  },

  outreach: {
    /**
     * Reply-To of last resort, used only when a tenant has not set their own.
     * Never left empty: a subcontractor reply that bounces is a lost bid.
     */
    get fallbackReplyTo() { return str("OUTREACH_REPLY_TO", "info@brostco.com"); },
    /**
     * From header used when tenant lookup is impossible (database down, no org
     * context). Deliberately the founding tenant's verified identity, not the
     * shared domain: a transient outage must not quietly downgrade a customer
     * who has already verified their own domain.
     */
    get fallbackFrom() { return str("OUTREACH_FROM", "BROSTCO <info@brostco.com>"); },
  },

  stripe: {
    get secretKey() { return str("STRIPE_SECRET_KEY"); },
    get webhookSecret() { return str("STRIPE_WEBHOOK_SECRET"); },
    get priceStandard() { return str("STRIPE_PRICE_STANDARD"); },
    get priceFounding() { return str("STRIPE_PRICE_FOUNDING"); },
    get enabled() {
      return Boolean(this.secretKey);
    },
  },

  queue: {
    redisUrl: str("REDIS_URL"),
    get backend(): "bullmq" | "pgboss" {
      return this.redisUrl ? "bullmq" : "pgboss";
    },
  },

  worker: {
    enabled: bool("RUN_WORKER", true),
    disabledAgents: list("DISABLED_AGENTS"),
    enableScrapers: bool("ENABLE_SCRAPERS", false),
  },
} as const;

/** Human-readable readiness report used by the /settings/integrations view and boot logs. */
export function integrationStatus() {
  return {
    database: Boolean(config.database.url),
    claude: config.claude.enabled,
    sam: config.sam.enabled,
    ahrefs: config.ahrefs.enabled,
    usaspending: true, // public API, always available
    bls: true, // works unauthenticated at low volume
    googleMaps: config.googleMaps.enabled,
    hunter: config.hunter.enabled,
    gmail: config.gmail.configured,
    twilio: config.twilio.enabled,
    resend: config.resend.enabled,
    supabaseStorage: config.supabase.enabled,
    queue: config.queue.backend,
  };
}
