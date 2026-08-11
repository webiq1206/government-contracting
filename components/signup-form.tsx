"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function SignupForm({
  initialPlan,
  promoActive,
}: {
  initialPlan: "founding" | "standard";
  promoActive: boolean;
}) {
  const router = useRouter();
  const plan =
    initialPlan === "founding" && !promoActive ? "standard" : initialPlan;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
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
        setError(data.error || "Could not create account.");
        setPending(false);
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      router.push(data.redirect || "/today");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setPending(false);
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
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>
      </div>
      <input type="hidden" name="plan" value={plan} />
      {error && <p className="text-sm text-risk">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending
          ? "Creating account…"
          : plan === "founding"
            ? "Continue to founding checkout"
            : "Continue to checkout"}
      </button>
      <p className="text-center text-xs text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
