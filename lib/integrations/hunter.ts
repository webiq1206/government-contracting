/**
 * Hunter.io client, email discovery and verification for vendor/contact
 * outreach.
 *
 * The key belongs to the organization, not the platform: Hunter bills per
 * lookup against a credit balance, so a customer's searches must draw on their
 * own account. Resolved per call via orgApiKey; when they have not set one,
 * every method returns { disabled: true, ... } with a safe empty payload so
 * callers never crash.
 */
import { config } from "../config";
import { orgApiKey } from "../integration-keys";
import { fetchJson, withRetry } from "./http";

const DOMAIN_SEARCH = "https://api.hunter.io/v2/domain-search";
const EMAIL_FINDER = "https://api.hunter.io/v2/email-finder";
const EMAIL_VERIFIER = "https://api.hunter.io/v2/email-verifier";

/** A single email record returned by domainSearch. */
export interface HunterEmail {
  value: string;
  confidence: number;
  first_name?: string;
  last_name?: string;
  position?: string;
}

interface DomainSearchResponse {
  data?: {
    emails?: Array<{
      value?: string;
      confidence?: number;
      first_name?: string | null;
      last_name?: string | null;
      position?: string | null;
    }>;
  };
}

interface EmailFinderResponse {
  data?: { email?: string | null; score?: number };
}

interface EmailVerifierResponse {
  data?: { status?: string; score?: number };
}

export const hunter = {
  /** List discoverable emails for a domain. */
  async domainSearch(
    domain: string
  ): Promise<{ disabled?: boolean; emails: HunterEmail[] }> {
    const apiKey = await orgApiKey("HUNTER_API_KEY");
    if (!apiKey) return { disabled: true, emails: [] };
    try {
      const data = await withRetry(() =>
        fetchJson<DomainSearchResponse>(DOMAIN_SEARCH, {
          query: { domain, api_key: apiKey },
        })
      );
      const emails: HunterEmail[] = (data.data?.emails ?? [])
        .filter((e): e is { value: string } & typeof e => Boolean(e.value))
        .map((e) => ({
          value: e.value ?? "",
          confidence: e.confidence ?? 0,
          first_name: e.first_name ?? undefined,
          last_name: e.last_name ?? undefined,
          position: e.position ?? undefined,
        }));
      return { emails };
    } catch {
      return { emails: [] };
    }
  },

  /** Guess the most likely email for a named person at a domain. */
  async findEmail(params: {
    domain: string;
    first_name?: string;
    last_name?: string;
    company?: string;
  }): Promise<{ disabled?: boolean; email?: string; score?: number }> {
    const apiKey = await orgApiKey("HUNTER_API_KEY");
    if (!apiKey) return { disabled: true };
    try {
      const data = await withRetry(() =>
        fetchJson<EmailFinderResponse>(EMAIL_FINDER, {
          query: {
            domain: params.domain,
            first_name: params.first_name,
            last_name: params.last_name,
            company: params.company,
            api_key: apiKey,
          },
        })
      );
      return {
        email: data.data?.email ?? undefined,
        score: data.data?.score,
      };
    } catch {
      return {};
    }
  },

  /** Verify deliverability of an email. status is e.g. "valid"/"invalid"/"accept_all". */
  async verifyEmail(
    email: string
  ): Promise<{ disabled?: boolean; status?: string; score?: number }> {
    const apiKey = await orgApiKey("HUNTER_API_KEY");
    if (!apiKey) return { disabled: true };
    try {
      const data = await withRetry(() =>
        fetchJson<EmailVerifierResponse>(EMAIL_VERIFIER, {
          query: { email, api_key: apiKey },
        })
      );
      return {
        status: data.data?.status,
        score: data.data?.score,
      };
    } catch {
      return {};
    }
  },
};
