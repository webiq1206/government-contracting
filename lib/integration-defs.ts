/**
 * Shared catalog of manageable integrations: what each one powers (in plain
 * English), which env keys it uses, and where to get credentials. Used by the
 * Integrations page and its API routes.
 */

export interface IntegrationFieldDef {
  env: string;
  label: string;
  /** Secret values render masked and are never echoed back in full. */
  secret: boolean;
  placeholder?: string;
}

export interface IntegrationDef {
  id: string;
  name: string;
  what: string;
  without: string;
  where: string;
  fields: IntegrationFieldDef[];
  /** Has a live "Test connection" validator. */
  testable: boolean;
}

export const INTEGRATION_DEFS: IntegrationDef[] = [
  {
    id: "sam",
    name: "SAM.gov",
    what: "Pulls new federal opportunities into your pipeline every 2 hours and checks subcontractors against the exclusion (debarment) list.",
    without: "No new opportunities enter the pipeline.",
    where: "sam.gov → sign in → Account Details → Request API Key (free; renew yearly).",
    fields: [{ env: "SAM_API_KEY", label: "API key", secret: true }],
    testable: true,
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    what: "Powers opportunity scoring, the plain-English Bid Brief, call scripts, and the weekly learning analysis.",
    without: "Scoring falls back to basic rules and briefs are not written.",
    where: "console.anthropic.com → API Keys.",
    fields: [{ env: "ANTHROPIC_API_KEY", label: "API key", secret: true }],
    testable: true,
  },
  {
    id: "googleMaps",
    name: "Google Maps (Places)",
    what: "Finds and ranks local subcontractors for each trade a project needs.",
    without: "Sub Finder can't discover new subcontractors.",
    where: "console.cloud.google.com → enable the Places API → create an API key.",
    fields: [{ env: "GOOGLE_MAPS_API_KEY", label: "API key", secret: true }],
    testable: true,
  },
  {
    id: "hunter",
    name: "Hunter.io",
    what: "Finds and verifies subcontractor email addresses so outreach actually lands.",
    without: "Outreach only uses emails already on file.",
    where: "hunter.io → API.",
    fields: [{ env: "HUNTER_API_KEY", label: "API key", secret: true }],
    testable: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    what: "Sends subcontractor outreach from your address, sends the 48-hour follow-ups, and detects replies to queue calls automatically.",
    without: "No automated outreach emails; you contact subs manually.",
    where: "console.cloud.google.com → OAuth client (Web) → paste ID + secret here, then click Connect Gmail.",
    fields: [
      { env: "GMAIL_CLIENT_ID", label: "OAuth client ID", secret: false },
      { env: "GMAIL_CLIENT_SECRET", label: "OAuth client secret", secret: true },
      { env: "GMAIL_SENDER", label: "Send-as address", secret: false, placeholder: "you@yourcompany.com" },
    ],
    testable: false,
  },
  {
    id: "resend",
    name: "Resend",
    what: "Sends your daily analytics digest and system emails.",
    without: "No email digests (everything is still visible in the app).",
    where: "resend.com → API Keys.",
    fields: [
      { env: "RESEND_API_KEY", label: "API key", secret: true },
      { env: "DIGEST_EMAIL_TO", label: "Send digest to", secret: false, placeholder: "you@yourcompany.com" },
    ],
    testable: true,
  },
  {
    id: "twilio",
    name: "Twilio SMS",
    what: "Texts you urgent alerts: bid deadlines under 48 hours and compliance blocks.",
    without: "Urgent items only appear in the app, not on your phone.",
    where: "console.twilio.com → Account Info.",
    fields: [
      { env: "TWILIO_ACCOUNT_SID", label: "Account SID", secret: false },
      { env: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
      { env: "TWILIO_FROM_NUMBER", label: "From number", secret: false, placeholder: "+1208..." },
      { env: "ALERT_SMS_TO", label: "Send alerts to", secret: false, placeholder: "+1208..." },
    ],
    testable: true,
  },
  {
    id: "bls",
    name: "BLS (inflation data)",
    what: "Adjusts historical award prices for inflation so pricing comps are apples-to-apples. Works without a key at low volume.",
    without: "Pricing comps still work, with a lower daily request limit.",
    where: "data.bls.gov/registrationEngine (free).",
    fields: [{ env: "BLS_API_KEY", label: "API key (optional)", secret: true }],
    testable: true,
  },
  {
    id: "supabaseStorage",
    name: "Supabase Storage",
    what: "Durable cloud storage for solicitation attachments and generated bid documents.",
    without: "Files are stored on local disk, which does not survive redeploys on Replit.",
    where: "supabase.com → Project Settings → API.",
    fields: [
      { env: "SUPABASE_URL", label: "Project URL", secret: false, placeholder: "https://xxxx.supabase.co" },
      { env: "SUPABASE_SERVICE_ROLE_KEY", label: "Service role key", secret: true },
    ],
    testable: true,
  },
  {
    id: "usaspending",
    name: "USASpending",
    what: "Historical award data behind your pricing comps. Public API.",
    without: "",
    where: "No key needed.",
    fields: [],
    testable: true,
  },
];
