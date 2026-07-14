/**
 * Shared catalog of manageable integrations: what each one powers (in plain
 * English), which env keys it uses, where to get credentials, and a step-by-step
 * guide with direct links. Used by the Integrations page and its API routes.
 */

export interface IntegrationFieldDef {
  env: string;
  label: string;
  /** Secret values render masked and are never echoed back in full. */
  secret: boolean;
  placeholder?: string;
}

/** Plain-English "how to get this key", shown in an info box on the card. */
export interface IntegrationGuide {
  /** Short cost/renewal note, e.g. "Free. Renew yearly." */
  cost?: string;
  /** Numbered, do-this-then-that steps a non-technical owner can follow. */
  steps: string[];
  /** Direct links straight to the page they need. */
  links: { label: string; url: string }[];
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
  guide?: IntegrationGuide;
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
    guide: {
      cost: "Free. The key expires once a year, so renew it annually.",
      steps: [
        "Open SAM.gov and sign in (create a free Login.gov account if you don't have one).",
        "Click your name in the top-right corner and choose Account Details.",
        "Scroll to the API Keys section and click Request/Generate a public API key.",
        "Copy the key it shows you and paste it in the box above, then press Test connection and Save.",
      ],
      links: [
        { label: "Open SAM.gov", url: "https://sam.gov/" },
        { label: "Account details", url: "https://sam.gov/profile/details" },
      ],
    },
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    what: "Powers opportunity scoring, the plain-English Bid Brief, call scripts, and the weekly learning analysis.",
    without: "Scoring falls back to basic rules and briefs are not written.",
    where: "console.anthropic.com → API Keys.",
    fields: [{ env: "ANTHROPIC_API_KEY", label: "API key", secret: true }],
    testable: true,
    guide: {
      cost: "Pay only for what you use. Add a small credit (about $5-10) to start.",
      steps: [
        "Open the Anthropic Console and sign in or sign up.",
        "Go to Settings, then API keys, and click Create Key. Give it a name.",
        "Copy the key immediately (it is only shown once) and paste it above.",
        "Open Billing and add a little credit so the key can be used.",
      ],
      links: [
        { label: "Create an API key", url: "https://console.anthropic.com/settings/keys" },
        { label: "Add billing credit", url: "https://console.anthropic.com/settings/billing" },
      ],
    },
  },
  {
    id: "ahrefs",
    name: "Ahrefs (Site Authority)",
    what: "Powers the autonomous Site Authority module: tracks your Domain Rating and referring domains, mines competitors' backlink profiles for prospects, and monitors new and lost backlinks.",
    without: "The Site Authority dashboard has no live data and no backlink prospects are discovered.",
    where: "ahrefs.com → Account → API keys (requires an API-enabled plan).",
    fields: [
      { env: "AHREFS_API_KEY", label: "API key", secret: true },
      { env: "AHREFS_TARGET", label: "Your domain", secret: false, placeholder: "brostco.com" },
    ],
    testable: true,
    guide: {
      cost: "Paid. Requires an Ahrefs plan with API access; billed per row of data pulled.",
      steps: [
        "Sign in to Ahrefs and open your Account settings.",
        "Go to the API keys section and generate a new API key (API access must be enabled on your plan).",
        "Copy the key and paste it above. Put the domain you're building authority for (e.g. brostco.com) in Your domain.",
        "Press Test connection and Save. The Site Authority dashboard will populate on the next scan.",
      ],
      links: [
        { label: "Ahrefs API keys", url: "https://app.ahrefs.com/api/profile" },
        { label: "Ahrefs API docs", url: "https://docs.ahrefs.com/docs/api/reference/introduction" },
      ],
    },
  },
  {
    id: "googleMaps",
    name: "Google Maps (Places)",
    what: "Finds and ranks local subcontractors for each trade a project needs.",
    without: "Sub Finder can't discover new subcontractors.",
    where: "console.cloud.google.com → enable the Places API → create an API key.",
    fields: [{ env: "GOOGLE_MAPS_API_KEY", label: "API key", secret: true }],
    testable: true,
    guide: {
      cost: "Google gives a free monthly credit that covers normal use; heavy use is pay-per-lookup.",
      steps: [
        "Open the Google Cloud Console and sign in. Create a project (or pick one) at the top.",
        "Use the Enable Places API link below and click Enable.",
        "Go to APIs & Services, then Credentials, click Create credentials, and choose API key.",
        "Copy the key and paste it above. Then press Test connection and Save.",
      ],
      links: [
        { label: "Google Cloud Console", url: "https://console.cloud.google.com/" },
        { label: "Enable Places API", url: "https://console.cloud.google.com/apis/library/places-backend.googleapis.com" },
        { label: "Credentials page", url: "https://console.cloud.google.com/apis/credentials" },
      ],
    },
  },
  {
    id: "hunter",
    name: "Hunter.io",
    what: "Finds and verifies subcontractor email addresses so outreach actually lands.",
    without: "Outreach only uses emails already on file.",
    where: "hunter.io → API.",
    fields: [{ env: "HUNTER_API_KEY", label: "API key", secret: true }],
    testable: true,
    guide: {
      cost: "Free tier covers light use; paid plans add volume.",
      steps: [
        "Open Hunter.io and create a free account.",
        "Go to the API keys page (link below).",
        "Copy your API key and paste it above, then press Test connection and Save.",
      ],
      links: [
        { label: "Hunter.io API keys", url: "https://hunter.io/api-keys" },
        { label: "Create an account", url: "https://hunter.io/users/sign_up" },
      ],
    },
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
    guide: {
      cost: "Free. Uses your own Gmail or Google Workspace account.",
      steps: [
        "In the Google Cloud Console, open APIs & Services, then OAuth consent screen. Choose External, fill the basics, and add your own email as a test user.",
        "Go to Credentials, click Create credentials, and choose OAuth client ID. Pick Application type: Web application.",
        "Under Authorized redirect URIs, add your site address followed by /api/integrations/gmail/callback (for example https://brostco.com/api/integrations/gmail/callback).",
        "Copy the Client ID and Client secret into the boxes above, put your Gmail address in Send-as, press Save, then click Connect Gmail and approve.",
      ],
      links: [
        { label: "OAuth consent screen", url: "https://console.cloud.google.com/apis/credentials/consent" },
        { label: "Create OAuth client", url: "https://console.cloud.google.com/apis/credentials" },
      ],
    },
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
    guide: {
      cost: "Free tier covers low volume.",
      steps: [
        "Open Resend and sign up.",
        "Go to API Keys and click Create API Key (Sending access is enough). Copy it.",
        "Paste the key above and enter where the daily digest should go in Send digest to.",
        "For best delivery, verify your own domain under Domains (optional to start).",
      ],
      links: [
        { label: "Resend API keys", url: "https://resend.com/api-keys" },
        { label: "Verify a domain", url: "https://resend.com/domains" },
      ],
    },
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
    guide: {
      cost: "Pay per text (pennies). A phone number is about $1-2 per month.",
      steps: [
        "Open the Twilio Console and sign in or sign up.",
        "On the dashboard, copy your Account SID and Auth Token into the boxes above.",
        "Buy a phone number with SMS enabled (Phone Numbers link below) and put it in From number.",
        "Put your own cell number in Send alerts to, then press Test connection and Save.",
      ],
      links: [
        { label: "Twilio Console", url: "https://console.twilio.com/" },
        { label: "Buy a phone number", url: "https://console.twilio.com/us1/develop/phone-numbers/manage/search" },
      ],
    },
  },
  {
    id: "bls",
    name: "BLS (inflation data)",
    what: "Adjusts historical award prices for inflation so pricing comps are apples-to-apples. Works without a key at low volume.",
    without: "Pricing comps still work, with a lower daily request limit.",
    where: "data.bls.gov/registrationEngine (free).",
    fields: [{ env: "BLS_API_KEY", label: "API key (optional)", secret: true }],
    testable: true,
    guide: {
      cost: "Free, and optional. Only raises the daily request limit.",
      steps: [
        "Open the BLS registration page (link below).",
        "Enter your email address to receive a free registration key.",
        "Paste the key above, then press Test connection and Save.",
      ],
      links: [
        { label: "BLS key registration", url: "https://data.bls.gov/registrationEngine/" },
      ],
    },
  },
  {
    id: "supabaseStorage",
    name: "Supabase Storage (optional)",
    what: "Optional off-database storage for attachments and bid documents. Not required, by default files are stored durably in your database and survive redeploys.",
    without: "Files are stored durably in your Postgres database (survives redeploys). Connect this only if you'd rather keep large files out of the database.",
    where: "supabase.com → Project Settings → API.",
    fields: [
      { env: "SUPABASE_URL", label: "Project URL", secret: false, placeholder: "https://xxxx.supabase.co" },
      { env: "SUPABASE_SERVICE_ROLE_KEY", label: "Service role key", secret: true },
    ],
    testable: true,
    guide: {
      cost: "Free tier is generous for documents.",
      steps: [
        "Open the Supabase dashboard and open your project (or create a free one).",
        "Go to Project Settings, then API.",
        "Copy the Project URL into the first box above.",
        "Copy the service_role key (not the anon key) into the second box, then Test connection and Save. Keep this key private.",
      ],
      links: [
        { label: "Supabase dashboard", url: "https://supabase.com/dashboard" },
      ],
    },
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
