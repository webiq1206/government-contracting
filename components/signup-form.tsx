"use client";

import { useRef, useState } from "react";
import { actionError } from "@/lib/client/action-request";
import Link from "next/link";

export function SignupForm({
  initialPlan,
  promoActive,
}: {
  initialPlan: "founding" | "standard";
  promoActive: boolean;
}) {
  const submitting = useRef(false);
  const plan =
    initialPlan === "founding" && !promoActive ? "standard" : initialPlan;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(fd.get("name") || ""),
          companyName: String(fd.get("companyName") || ""),
          email: String(fd.get("email") || ""),
          password: String(fd.get("password") || ""),
          plan,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        checkoutUrl?: string;
        redirect?: string;
      };
      if (!res.ok) {
        setError(actionError(res.status, data.error));
        setPending(false);
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      window.location.replace(data.redirect === "/today" ? data.redirect : "/today");
    } catch {
      setError("Account setup could not be confirmed. Your details are still here. Try signing in before creating the account again.");
      setPending(false);
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          className="input mt-1"
          autoComplete="name"
        />
      </div>
      <div>
        <label className="label" htmlFor="companyName">
          Company name
        </label>
        <input
          id="companyName"
          name="companyName"
          required
          className="input mt-1"
          autoComplete="organization"
        />
      </div>
      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="input mt-1"
          autoComplete="email"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          className="input mt-1"
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <input type="hidden" name="plan" value={plan} />
      {error && <p role="alert" className="text-sm text-risk">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending
          ? "Creating account..."
          : plan === "founding"
            ? "Start founding 7-day free trial"
            : "Start 7-day free trial"}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
