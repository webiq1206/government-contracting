/**
 * The chosen sending address across a reconnect.
 *
 * Reconnecting is ordinary maintenance: a grant lapses, the owner signs in
 * again. If that quietly cleared the chosen address, every outreach email
 * afterwards would go out from the Google account instead of the company
 * address, and nobody would be told. If it kept the address across a switch
 * to a DIFFERENT mailbox, the app would try to send as an address the new
 * account never verified and Google would refuse every send.
 *
 * Both directions are pinned here, against the real insert, because the rule
 * lives in the SQL rather than in application code.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("the sending address survives the right reconnects (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let exchangeCode: typeof import("../lib/integrations/gmail").exchangeCode;

  const orgId = { current: "" };
  /** The address the fake Google profile call reports for the next exchange. */
  const authorizedAs = { current: "hello@webiq.co" as string | null };

  beforeAll(async () => {
    process.env.GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || "test-client-id";
    process.env.GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "test-client-secret";
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ||
      "test-secret-that-is-plenty-long-for-aes-key-derivation-000000";

    vi.doMock("googleapis", () => ({
      google: {
        auth: {
          OAuth2: class {
            setCredentials() {}
            async getToken() {
              return { tokens: { refresh_token: "refresh-" + randomUUID() } };
            }
          },
        },
        gmail: () => ({
          users: {
            getProfile: async () => {
              if (!authorizedAs.current) throw new Error("profile unavailable");
              return { data: { emailAddress: authorizedAs.current } };
            },
          },
        }),
      },
    }));

    ({ query, queryOne } = await import("../lib/db"));
    ({ exchangeCode } = await import("../lib/integrations/gmail"));

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [`sendas-${randomUUID()}`]
    );
    orgId.current = org!.id;
  });

  afterAll(async () => {
    if (orgId.current) {
      await query(`delete from integration_tokens where org_id = $1`, [orgId.current]);
      await query(`delete from organizations where id = $1`, [orgId.current]);
    }
    vi.doUnmock("googleapis");
  });

  async function storedSendAs(): Promise<string | null> {
    const row = await queryOne<{ send_as: string | null }>(
      `select send_as from integration_tokens where provider = 'gmail' and org_id = $1`,
      [orgId.current]
    );
    return row?.send_as ?? null;
  }

  it("keeps the chosen address when the same mailbox is reconnected", async () => {
    authorizedAs.current = "hello@webiq.co";
    await exchangeCode("code-1", orgId.current);
    await query(
      `update integration_tokens set send_as = 'hello@brostco.com'
        where provider = 'gmail' and org_id = $1`,
      [orgId.current]
    );

    await exchangeCode("code-2", orgId.current);
    expect(await storedSendAs()).toBe("hello@brostco.com");
  });

  it("drops it when a different mailbox is connected, because the alias was not theirs", async () => {
    expect(await storedSendAs()).toBe("hello@brostco.com");
    authorizedAs.current = "someone-else@example.com";
    const res = await exchangeCode("code-3", orgId.current);
    expect(await storedSendAs()).toBeNull();
    // The reconnect screen says so, because otherwise outreach quietly starts
    // going out from the connected account again.
    expect(res.senderReset).toBe(true);
  });

  it("saves nothing at all when Google will not say which mailbox this is", async () => {
    authorizedAs.current = "hello@webiq.co";
    await exchangeCode("code-4", orgId.current);
    await query(
      `update integration_tokens set send_as = 'hello@brostco.com'
        where provider = 'gmail' and org_id = $1`,
      [orgId.current]
    );

    /*
     * An unidentified mailbox cannot be a sending identity.
     *
     * Storing the new token while keeping the old address would leave the
     * connection looking healthy and every email going out as an account this
     * grant may have no right to send as. Refusing leaves the previous
     * connection untouched and costs the operator one more click.
     */
    authorizedAs.current = null;
    await expect(exchangeCode("code-5", orgId.current)).rejects.toThrow(/try connecting again/i);

    const row = await queryOne<{ email: string | null; send_as: string | null }>(
      `select email, send_as from integration_tokens where provider = 'gmail' and org_id = $1`,
      [orgId.current]
    );
    expect(row?.email).toBe("hello@webiq.co");
    expect(row?.send_as).toBe("hello@brostco.com");
  });
});
