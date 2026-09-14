/**
 * Connected apps: what each one is for, what it reads and writes, and how
 * its status is judged. Pure; the OAuth flows, API calls and database live
 * in lib/connected-services.ts and lib/integrations/*.
 *
 * Every provider states in plain words what connecting it lets a person do
 * and what the platform will read, write or send. Nothing here promises
 * more than the code behind it does: a provider whose OAuth app the
 * platform has not registered is "unavailable", never "connect".
 */
export type ServiceProvider =
  | "google_calendar"
  | "google_drive"
  | "microsoft_calendar"
  | "microsoft_onedrive"
  | "slack"
  | "teams"
  | "dropbox"
  | "box";

export type ServiceFamily = "google" | "microsoft" | "slack" | "teams" | "dropbox" | "box";
export type ServiceKind = "calendar" | "files" | "notifications";
export type ConnectionScope = "company" | "personal";

export interface ServiceDefinition {
  id: ServiceProvider;
  family: ServiceFamily;
  kind: ServiceKind;
  name: string;
  /** One sentence: what connecting it lets the person do. */
  lets: string;
  /** What the platform reads from the service. */
  reads: string;
  /** What the platform writes or sends. */
  writes: string;
  /** One-way or two-way, spelled out. */
  direction: string;
  /** Which connection scopes make sense. */
  scopes: ConnectionScope[];
  /** OAuth scopes requested, for the consent explanation. */
  oauthScopes: string[];
  /** Env keys the PLATFORM must hold for this provider to be offered at all. */
  platformKeys: string[];
  /** How the connection is made: OAuth consent, or a URL the person pastes. */
  method: "oauth" | "webhook_url";
  /** Shown when the platform has not registered the provider app yet. */
  unavailableNote: string;
  /** Steps for a URL-based connection. */
  setupSteps?: string[];
}

export const SERVICE_DEFS: ServiceDefinition[] = [
  {
    id: "google_calendar",
    family: "google",
    kind: "calendar",
    name: "Google Calendar",
    lets: "Put every bid deadline on a calendar you choose, and keep it updated when the deadline moves or the bid is passed.",
    reads: "The list of your calendars, so you can pick one.",
    writes: "One event per pursued opportunity's submission deadline, on the calendar you pick. Nothing else on that calendar is touched.",
    direction: "One-way, Brost Co to your calendar. Edits you make to an event are not read back.",
    scopes: ["personal", "company"],
    oauthScopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ],
    platformKeys: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "The platform's Google app is not configured on this deployment.",
  },
  {
    id: "google_drive",
    family: "google",
    kind: "files",
    name: "Google Drive",
    lets: "Save bid packages and solicitation documents into a Brost Co folder in your Drive.",
    reads: "Only files and folders Brost Co itself created in your Drive.",
    writes: "A 'Brost Co' folder, one subfolder per opportunity, and the documents you choose to save there. Nothing is imported from your Drive unless you save it here first.",
    direction: "One-way, Brost Co to your Drive.",
    scopes: ["personal", "company"],
    oauthScopes: ["https://www.googleapis.com/auth/drive.file"],
    platformKeys: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "The platform's Google app is not configured on this deployment.",
  },
  {
    id: "microsoft_calendar",
    family: "microsoft",
    kind: "calendar",
    name: "Outlook Calendar (Microsoft 365)",
    lets: "Put every bid deadline on an Outlook calendar you choose, and keep it updated when the deadline moves or the bid is passed.",
    reads: "The list of your calendars, so you can pick one.",
    writes: "One event per pursued opportunity's submission deadline, on the calendar you pick. Nothing else is touched.",
    direction: "One-way, Brost Co to your calendar.",
    scopes: ["personal", "company"],
    oauthScopes: ["offline_access", "User.Read", "Calendars.ReadWrite"],
    platformKeys: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "Brost Co has not registered its Microsoft 365 app yet. Nothing for you to set up; it will appear here when it is available.",
  },
  {
    id: "microsoft_onedrive",
    family: "microsoft",
    kind: "files",
    name: "OneDrive / SharePoint (Microsoft 365)",
    lets: "Save bid packages and solicitation documents into a Brost Co folder in your OneDrive.",
    reads: "Only files and folders Brost Co itself created.",
    writes: "A 'Brost Co' folder, one subfolder per opportunity, and the documents you choose to save there.",
    direction: "One-way, Brost Co to your OneDrive.",
    scopes: ["personal", "company"],
    oauthScopes: ["offline_access", "User.Read", "Files.ReadWrite"],
    platformKeys: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "Brost Co has not registered its Microsoft 365 app yet. Nothing for you to set up; it will appear here when it is available.",
  },
  {
    id: "slack",
    family: "slack",
    kind: "notifications",
    name: "Slack",
    lets: "Get the updates you choose (deadlines, replies, automation problems, new opportunities) in one Slack channel.",
    reads: "Nothing from Slack.",
    writes: "Messages to the one channel you pick during connection. Nothing is read from your workspace.",
    direction: "One-way, Brost Co to Slack.",
    scopes: ["company"],
    oauthScopes: ["incoming-webhook"],
    platformKeys: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "Brost Co has not registered its Slack app yet. Nothing for you to set up; it will appear here when it is available.",
  },
  {
    id: "teams",
    family: "teams",
    kind: "notifications",
    name: "Microsoft Teams",
    lets: "Get the updates you choose (deadlines, replies, automation problems, new opportunities) in one Teams channel.",
    reads: "Nothing from Teams.",
    writes: "Messages to the channel behind the workflow link you paste. Nothing is read from Teams.",
    direction: "One-way, Brost Co to Teams.",
    scopes: ["company"],
    oauthScopes: [],
    platformKeys: [],
    method: "webhook_url",
    unavailableNote: "",
    setupSteps: [
      "In Teams, open the channel, choose Workflows, and pick \"Post to a channel when a webhook request is received\".",
      "Name it Brost Co, finish the workflow, and copy the link it shows.",
      "Paste the link below and press Connect. Send a test message to confirm it lands.",
    ],
  },
  {
    id: "dropbox",
    family: "dropbox",
    kind: "files",
    name: "Dropbox",
    lets: "Save bid packages and solicitation documents into a Brost Co folder in your Dropbox.",
    reads: "Only the Brost Co folder it creates.",
    writes: "A 'Brost Co' folder, one subfolder per opportunity, and the documents you choose to save there.",
    direction: "One-way, Brost Co to Dropbox.",
    scopes: ["personal", "company"],
    oauthScopes: ["files.content.write", "files.metadata.read"],
    platformKeys: ["DROPBOX_CLIENT_ID", "DROPBOX_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "Brost Co has not registered its Dropbox app yet. Nothing for you to set up; it will appear here when it is available.",
  },
  {
    id: "box",
    family: "box",
    kind: "files",
    name: "Box",
    lets: "Save bid packages and solicitation documents into a Brost Co folder in your Box.",
    reads: "Only the Brost Co folder it creates.",
    writes: "A 'Brost Co' folder, one subfolder per opportunity, and the documents you choose to save there.",
    direction: "One-way, Brost Co to Box.",
    scopes: ["personal", "company"],
    oauthScopes: ["root_readwrite"],
    platformKeys: ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET"],
    method: "oauth",
    unavailableNote: "Brost Co has not registered its Box app yet. Nothing for you to set up; it will appear here when it is available.",
  },
];

export const SERVICE_BY_ID: Record<ServiceProvider, ServiceDefinition> = Object.fromEntries(
  SERVICE_DEFS.map((d) => [d.id, d])
) as Record<ServiceProvider, ServiceDefinition>;

export function isServiceProvider(v: unknown): v is ServiceProvider {
  return typeof v === "string" && v in SERVICE_BY_ID;
}

/** Whether the platform holds what it needs to offer this provider. */
export function providerAvailable(def: ServiceDefinition, env: Record<string, string | undefined>): boolean {
  return def.platformKeys.every((k) => Boolean(env[k]?.trim()));
}

export type ServiceStatus = "connected" | "needs_attention" | "paused" | "disconnected";

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  paused: "Paused",
  disconnected: "Disconnected",
};

/** One line describing sync health for a card. */
export function syncLine(s: { status: ServiceStatus; last_synced_at: string | Date | null; last_error: string | null }): string {
  if (s.status === "disconnected") return "Disconnected. Nothing is read or sent.";
  if (s.status === "paused") return "Paused. Nothing is sent until you resume.";
  if (s.status === "needs_attention") return s.last_error ?? "The connection stopped working. Reconnect to continue.";
  if (!s.last_synced_at) return "Connected. Nothing has needed syncing yet.";
  const at = new Date(s.last_synced_at);
  return Number.isNaN(at.getTime()) ? "Connected." : `Connected. Last synced ${at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
}

/**
 * Events a channel or webhook can subscribe to. Keys are stable; labels are
 * what the settings page shows. Mapped from the activity ledger's category
 * and status so the same event never arrives twice.
 */
export interface EventDef {
  key: string;
  label: string;
  hint: string;
}

export const NOTIFY_EVENTS: EventDef[] = [
  { key: "deadline", label: "Deadlines approaching", hint: "A pursued bid is due within the warning window." },
  { key: "reply", label: "Subcontractor replies", hint: "A subcontractor answered and a person needs to read it." },
  { key: "opportunity", label: "New opportunities", hint: "A new opportunity was found or added and scored." },
  { key: "bid", label: "Bid milestones", hint: "A package was built, approved, submitted, won or lost." },
  { key: "automation", label: "Automation problems", hint: "Something stopped: a key refused, a budget hit, a job failing." },
  { key: "compliance", label: "Compliance and renewals", hint: "A registration or certificate is due or lapsed." },
];

export const NOTIFY_EVENT_KEYS = new Set(NOTIFY_EVENTS.map((e) => e.key));

/** Activity ledger categories that feed each event key. */
const CATEGORY_EVENT: Record<string, string> = {
  reply: "reply",
  opportunity: "opportunity",
  bid: "bid",
  automation: "automation",
  compliance: "compliance",
};

export interface LedgerEvent {
  id: string | number;
  category: string;
  status: string;
  title: string;
  actor: string;
  occurred_at: string | Date;
  opportunity_id: string | null;
  detail: Record<string, unknown> | null;
}

/** Which subscription an activity row belongs to, or null when nobody would want it. */
export function eventKeyFor(e: LedgerEvent): string | null {
  if (e.category === "opportunity" && /deadline|due/i.test(e.title)) return "deadline";
  return CATEGORY_EVENT[e.category] ?? null;
}

/** Plain text for a channel message. */
export function notificationText(e: LedgerEvent, appUrl: string): string {
  const link = e.opportunity_id ? ` ${appUrl}/opportunity/${e.opportunity_id}` : "";
  const who = e.actor && e.actor !== "system" ? ` (${e.actor})` : "";
  return `${e.title}${who}${link}`;
}

/** Retry schedule for a failed delivery, in minutes; abandoned after the last. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 720];

export function nextRetryAt(attempts: number, now = new Date()): Date | null {
  const minutes = WEBHOOK_RETRY_MINUTES[attempts - 1];
  if (minutes == null) return null;
  return new Date(now.getTime() + minutes * 60_000);
}

/** The calendar event for an opportunity, and the fingerprint that says whether it changed. */
export interface DeadlineEventInput {
  id: string;
  title: string | null;
  agency: string | null;
  solicitation_number: string | null;
  deadline: string | Date;
  stage: string;
  status: string;
  pursuit_state: string | null;
}

export interface CalendarEvent {
  localKey: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  fingerprint: string;
  /** True when the event should be removed from the calendar. */
  cancelled: boolean;
}

export function deadlineEvent(o: DeadlineEventInput, appUrl: string): CalendarEvent {
  const at = new Date(o.deadline);
  const start = at.toISOString();
  const end = new Date(at.getTime() + 30 * 60_000).toISOString();
  const cancelled = o.status !== "open" || (o.pursuit_state ?? "active") === "aborted" || ["dismissed", "lost", "expired"].includes(o.stage);
  const summary = `Bid due: ${o.title ?? "Untitled opportunity"}`;
  const description = [
    o.agency ? `Agency: ${o.agency}` : null,
    o.solicitation_number ? `Solicitation: ${o.solicitation_number}` : null,
    `Record: ${appUrl}/opportunity/${o.id}`,
    "Added by Brost Co. Edits here are not read back; change the deadline on the record.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    localKey: `opportunity:${o.id}:deadline`,
    summary,
    description,
    start,
    end,
    fingerprint: `${cancelled ? "x" : "v"}|${start}|${summary}|${o.agency ?? ""}`,
    cancelled,
  };
}

/** A safe name for a folder in the person's file storage. */
export function folderName(o: { title: string | null; solicitation_number: string | null }): string {
  const base = [o.solicitation_number, o.title].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Opportunity").slice(0, 120);
}
