"use client";

import { useState, type FormEvent } from "react";

export function ContactForm() {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          company_url: data.get("company_url"),
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : "We could not send that message. Email hello@brostco.com instead.",
        );
        return;
      }
      setSent(true);
      form.reset();
    } catch {
      setError("We could not send that message. Email hello@brostco.com instead.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="bco-contact-form" role="status">
        <h2>Message sent.</h2>
        <p>We will reply to the email address you gave us.</p>
        <p>
          If you do not hear back, email{" "}
          <a href="mailto:hello@brostco.com">hello@brostco.com</a>.
        </p>
      </div>
    );
  }

  return (
    <form className="bco-contact-form" method="post" action="/api/contact" onSubmit={onSubmit}>
      <div className="bco-honeypot" aria-hidden="true">
        <label>
          Company website
          <input name="company_url" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label htmlFor="contact-name">
        Your name
        <input id="contact-name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={120} />
      </label>
      <label htmlFor="contact-email">
        Email
        <input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </label>
      <label htmlFor="contact-message">
        Message
        <textarea id="contact-message" name="message" required minLength={2} maxLength={5000} rows={6} />
      </label>
      {error ? (
        <p className="bco-contact-status bco-contact-status-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="bco-actions">
        <button className="bco-button" type="submit" disabled={sending}>
          {sending ? "Sending..." : "Send message"}
        </button>
      </div>
      <p className="bco-caption">
        Or email <a href="mailto:hello@brostco.com">hello@brostco.com</a>. We use
        your message to reply. See the <a href="/privacy">privacy policy</a>.
      </p>
    </form>
  );
}
