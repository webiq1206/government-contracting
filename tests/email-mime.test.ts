import { describe, expect, it } from "vitest";
import { buildGmailRawMessage } from "../lib/integrations/gmail";
import { encodedHeader, singleMailbox } from "../lib/domain/email-mime";

const from = 'BrostCo <hello@brostco.com>';
const base = { to: 'owner@example.com', subject: 'BrostCo email test', html: '<p>Ready</p>' };
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

describe('standards-compliant outbound MIME', () => {
  it('preserves Unicode and long HTML in encoded body parts', () => {
    const text = 'Résumé ✓ '.repeat(250);
    const html = `<p>${text}</p>`;
    const raw = decode(buildGmailRawMessage({ ...base, text, html, subject: text }, from));
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/g)];
    expect(parts).toHaveLength(2);
    expect(Buffer.from(parts[0][1], 'base64').toString('utf8')).toBe(text);
    expect(Buffer.from(parts[1][1], 'base64').toString('utf8')).toBe(html);
    expect(Math.max(...raw.split('\r\n').map(line => Buffer.byteLength(line)))).toBeLessThan(998);
    expect(raw).toMatch(/\r\nDate: .+ GMT\r\n/);
  });

  it('folds subjects without splitting Unicode code points', () => {
    const subject = '你好 🛰️ café '.repeat(40);
    const encoded = encodedHeader(subject);
    const words = [...encoded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    expect(words.map(word => Buffer.from(word[1], 'base64').toString('utf8')).join('')).toBe(subject.trim());
    expect(words.every(word => word[0].length <= 75)).toBe(true);
  });

  it('keeps links readable in the plain-text alternative', () => {
    const raw = decode(buildGmailRawMessage({ ...base, html: '<p>Reset: <a href="https://brostco.com/reset-password?token=test">Open link</a></p>' }, from));
    const part = raw.match(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/)!;
    expect(Buffer.from(part[1], 'base64').toString()).toContain('https://brostco.com/reset-password?token=test');
  });

  it('rejects multiple senders and injected sender headers', () => {
    for (const value of ['hello@brostco.com,admin@brostco.com', 'hello@brostco.com\r\nBcc: x@example.com']) {
      expect(singleMailbox(value)).toBeNull();
      expect(() => buildGmailRawMessage(base, value)).toThrow();
    }
    expect(decode(buildGmailRawMessage(base, 'BrostCo, Inc. <hello@brostco.com>'))).toContain('From: "BrostCo, Inc." <hello@brostco.com>');
  });

  it('neutralizes attachment header injection and preserves attachment bytes', () => {
    const content = Buffer.from([0, 255, 128, 13, 10]);
    const raw = decode(buildGmailRawMessage({ ...base, attachments: [{ filename: 'résumé.pdf', mime: 'application/pdf\r\nBcc: attacker@example.com', content }] }, from));
    expect(raw).not.toContain('\r\nBcc:');
    expect(raw).toContain('Content-Type: application/octet-stream;');
    expect(raw).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
    expect(raw).toContain(content.toString('base64'));
  });

  it('keeps unsubscribe links direct even when click tracking is enabled', () => {
    const unsubscribeUrl = 'https://brostco.com/api/email/unsubscribe/token';
    const raw = decode(buildGmailRawMessage({ ...base, unsubscribeUrl, trackingId: 'tracking', html: `<a href="${unsubscribeUrl}">Stop outreach</a>` }, from));
    expect(raw).toContain(`List-Unsubscribe: <${unsubscribeUrl}>`);
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    const html = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/g)][1][1];
    expect(Buffer.from(html, 'base64').toString()).toContain(`href="${unsubscribeUrl}"`);
    expect(() => buildGmailRawMessage({ ...base, unsubscribeUrl: 'http://brostco.com/stop' }, from)).toThrow('HTTPS');
    expect(decode(buildGmailRawMessage(base, from))).not.toContain('List-Unsubscribe');
  });
});
