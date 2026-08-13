/**
 * Resend Domains API: register a customer's sending domain, hand back the DNS
 * records they must publish, and poll verification.
 *
 * This is what makes outreach work without any per-customer OAuth app. The
 * customer proves they own a domain by adding DNS records once; from then on
 * we send as them from our own infrastructure.
 *
 * Every method returns a result object rather than throwing, matching the rest
 * of lib/integrations: a provider outage must never take down a settings page.
 */
import { config } from "../config";
import { Resend } from "resend";

/** One DNS record the customer has to publish at their registrar. */
export interface DnsRecord {
  record: string; // "SPF" | "DKIM" | "DMARC"
  name: string;
  type: string; // "TXT" | "MX" | "CNAME"
  value: string;
  priority?: number;
  ttl?: string;
  status?: string;
}

export interface DomainResult {
  disabled?: boolean;
  error?: string;
  id?: string;
  name?: string;
  /** Resend status: not_started | pending | verified | failed | temporary_failure */
  status?: string;
  records?: DnsRecord[];
}

/**
 * Resend returns records with slightly different shapes across endpoints, so
 * normalise once here and let callers treat every record identically.
 */
function normalizeRecords(raw: unknown): DnsRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      record: String(rec.record ?? rec.type ?? ""),
      name: String(rec.name ?? ""),
      type: String(rec.type ?? "TXT"),
      value: String(rec.value ?? ""),
      ...(rec.priority != null ? { priority: Number(rec.priority) } : {}),
      ...(rec.ttl != null ? { ttl: String(rec.ttl) } : {}),
      ...(rec.status != null ? { status: String(rec.status) } : {}),
    };
  });
}

function client(): Resend | null {
  if (!config.resend.enabled) return null;
  return new Resend(config.resend.apiKey);
}

export const resendDomains = {
  enabled: () => config.resend.enabled,

  /** Register a sending domain and return the DNS records to publish. */
  async create(name: string): Promise<DomainResult> {
    const c = client();
    if (!c) return { disabled: true, error: "Resend is not configured." };
    try {
      const { data, error } = await c.domains.create({ name });
      if (error) return { error: error.message };
      return {
        id: data?.id,
        name: data?.name,
        status: data?.status,
        records: normalizeRecords((data as { records?: unknown } | null)?.records),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Current status + records for a registered domain. */
  async get(id: string): Promise<DomainResult> {
    const c = client();
    if (!c) return { disabled: true, error: "Resend is not configured." };
    try {
      const { data, error } = await c.domains.get(id);
      if (error) return { error: error.message };
      return {
        id: data?.id,
        name: data?.name,
        status: data?.status,
        records: normalizeRecords((data as { records?: unknown } | null)?.records),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /**
   * Ask Resend to re-check DNS now.
   *
   * Verification is asynchronous: a successful call means "checking started",
   * not "verified". Callers must read status back with get() rather than
   * assuming success, otherwise a tenant could be marked verified while their
   * DNS is still wrong and every outreach email would bounce.
   */
  async verify(id: string): Promise<DomainResult> {
    const c = client();
    if (!c) return { disabled: true, error: "Resend is not configured." };
    try {
      const { error } = await c.domains.verify(id);
      if (error) return { error: error.message };
      return this.get(id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Release a domain when a tenant changes or removes it. */
  async remove(id: string): Promise<{ error?: string; disabled?: boolean }> {
    const c = client();
    if (!c) return { disabled: true, error: "Resend is not configured." };
    try {
      const { error } = await c.domains.remove(id);
      return error ? { error: error.message } : {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
};
