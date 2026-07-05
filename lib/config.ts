/**
 * Central runtime configuration. Reads process.env once, applies sane defaults,
 * and exposes typed helpers. Nothing here throws at import time — the platform
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
    secret: str("AUTH_SECRET", "dev-insecure-secret-change-me"),
    // True when AUTH_SECRET was never set (still the public source default). Used
    // to disable the forgeable env-operator cookie path in production.
    get secretIsDefault() {
      return str("AUTH_SECRET", "dev-insecure-secret-change-me") === "dev-insecure-secret-change-me";
    },
    operatorEmail: str("OPERATOR_EMAIL"),
    operatorPasswordHash: str("OPERATOR_PASSWORD_HASH"),
  },

  supabase: {
    url: str("SUPABASE_URL"),
    serviceKey: str("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: str("SUPABASE_STORAGE_BUCKET", "brostco-documents"),
    get enabled() {
      return Boolean(this.url && this.serviceKey);
    },
  },

  claude: {
    apiKey: str("ANTHROPIC_API_KEY"),
    // Default tier — high-volume, lower-stakes agents (scoring, outreach, call
    // prep, sub-verify, digests). Fast and cheap.
    model: str("CLAUDE_MODEL", "claude-haiku-4-5"),
    // High-stakes tier — the bid-critical path where a missed requirement or a
    // fabricated fact costs a bid: the Solicitation Analyst (bid brief) and the
    // Learning Loop (rubric-weight analysis). Stronger model.
    modelSmart: str("CLAUDE_MODEL_SMART", "claude-sonnet-5"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  sam: {
    apiKey: str("SAM_API_KEY"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  usaspending: {
    baseUrl: str("USASPENDING_BASE_URL", "https://api.usaspending.gov"),
  },

  bls: {
    apiKey: str("BLS_API_KEY"),
  },

  googleMaps: {
    apiKey: str("GOOGLE_MAPS_API_KEY"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  hunter: {
    apiKey: str("HUNTER_API_KEY"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  gmail: {
    clientId: str("GMAIL_CLIENT_ID"),
    clientSecret: str("GMAIL_CLIENT_SECRET"),
    refreshToken: str("GMAIL_REFRESH_TOKEN"),
    sender: str("GMAIL_SENDER"),
    get redirectUri() {
      return `${config.appUrl}/api/integrations/gmail/callback`;
    },
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  twilio: {
    accountSid: str("TWILIO_ACCOUNT_SID"),
    authToken: str("TWILIO_AUTH_TOKEN"),
    fromNumber: str("TWILIO_FROM_NUMBER"),
    alertTo: str("ALERT_SMS_TO"),
    get enabled() {
      return Boolean(this.accountSid && this.authToken && this.fromNumber);
    },
  },

  resend: {
    apiKey: str("RESEND_API_KEY"),
    from: str("RESEND_FROM", "BROSTCO <alerts@brostco.com>"),
    digestTo: str("DIGEST_EMAIL_TO"),
    get enabled() {
      return Boolean(this.apiKey);
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
