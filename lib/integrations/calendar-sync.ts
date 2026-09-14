/**
 * Calendar providers: list calendars, put one deadline event on one, keep
 * it current, and cancel it when the bid is passed. Every call receives the
 * connection row and gets its own access token from lib/connected-services.
 */
import { google } from "googleapis";
import { accessToken, googleAuthFor, type ServiceRow } from "../connected-services";
import { fetchJson, HttpError } from "./http";
import type { CalendarEvent } from "../domain/connected-services";

export interface CalendarOption {
  id: string;
  name: string;
  primary: boolean;
}

export async function listCalendars(row: ServiceRow): Promise<CalendarOption[]> {
  if (row.provider === "google_calendar") {
    const auth = await googleAuthFor(row);
    const res = await google.calendar({ version: "v3", auth }).calendarList.list({ minAccessRole: "writer", maxResults: 100 });
    return (res.data.items ?? [])
      .filter((c) => c.id)
      .map((c) => ({ id: c.id!, name: c.summaryOverride ?? c.summary ?? c.id!, primary: Boolean(c.primary) }));
  }
  if (row.provider === "microsoft_calendar") {
    const token = await accessToken(row);
    const res = await fetchJson<{ value: { id: string; name: string; isDefaultCalendar?: boolean; canEdit?: boolean }[] }>(
      "https://graph.microsoft.com/v1.0/me/calendars",
      { headers: { authorization: `Bearer ${token}` }, query: { $top: 100 } }
    );
    return res.value.filter((c) => c.canEdit !== false).map((c) => ({ id: c.id, name: c.name, primary: Boolean(c.isDefaultCalendar) }));
  }
  throw new Error("Not a calendar connection.");
}

/** The calendar a connection writes to: the chosen one, else the primary. */
export function calendarIdOf(row: ServiceRow): string {
  const chosen = row.settings?.calendar_id;
  return typeof chosen === "string" && chosen ? chosen : "primary";
}

/** Create or update the event; returns the provider's id for the ledger. */
export async function upsertEvent(row: ServiceRow, event: CalendarEvent, remoteId: string | null): Promise<string> {
  if (row.provider === "google_calendar") {
    const auth = await googleAuthFor(row);
    const cal = google.calendar({ version: "v3", auth });
    const body = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start },
      end: { dateTime: event.end },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 24 * 60 }, { method: "popup", minutes: 60 }] },
    };
    if (remoteId) {
      try {
        const res = await cal.events.patch({ calendarId: calendarIdOf(row), eventId: remoteId, requestBody: body });
        return res.data.id ?? remoteId;
      } catch (err) {
        // The person deleted it by hand: recreate rather than fail forever.
        if ((err as { code?: number }).code !== 404 && (err as { code?: number }).code !== 410) throw err;
      }
    }
    const res = await cal.events.insert({ calendarId: calendarIdOf(row), requestBody: body });
    if (!res.data.id) throw new Error("Google did not return an event id.");
    return res.data.id;
  }
  if (row.provider === "microsoft_calendar") {
    const token = await accessToken(row);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const calendarId = calendarIdOf(row);
    const base = calendarId === "primary" ? "https://graph.microsoft.com/v1.0/me/events" : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`;
    const body = JSON.stringify({
      subject: event.summary,
      body: { contentType: "text", content: event.description },
      start: { dateTime: event.start.replace(/Z$/, ""), timeZone: "UTC" },
      end: { dateTime: event.end.replace(/Z$/, ""), timeZone: "UTC" },
      isReminderOn: true,
      reminderMinutesBeforeStart: 24 * 60,
    });
    if (remoteId) {
      try {
        const res = await fetchJson<{ id: string }>(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(remoteId)}`, { method: "PATCH", headers, body });
        return res.id ?? remoteId;
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 404) throw err;
      }
    }
    const res = await fetchJson<{ id: string }>(base, { method: "POST", headers, body });
    return res.id;
  }
  throw new Error("Not a calendar connection.");
}

/** Remove the event. A missing event is already the desired state. */
export async function deleteEvent(row: ServiceRow, remoteId: string): Promise<void> {
  if (row.provider === "google_calendar") {
    const auth = await googleAuthFor(row);
    try {
      await google.calendar({ version: "v3", auth }).events.delete({ calendarId: calendarIdOf(row), eventId: remoteId });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 404 && code !== 410) throw err;
    }
    return;
  }
  if (row.provider === "microsoft_calendar") {
    const token = await accessToken(row);
    try {
      await fetchJson(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(remoteId)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 404) throw err;
    }
    return;
  }
  throw new Error("Not a calendar connection.");
}
