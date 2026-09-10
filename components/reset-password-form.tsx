"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { actionError } from "@/lib/client/action-request";

export function ResetPasswordForm({ token }: { token: string }) {
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    const confirm = String(fd.get("confirm") || "");
    if (password !== confirm) {
      setError("Passwords do not match.");
      setPending(false);
      submitting.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(res.status < 500 ? actionError(res.status, data.error) : "We could not confirm your password change. Try signing in with the new password first, or request a new reset link.");
        return;
      }
      if (data.ok !== true) {
        setError("We could not confirm your password change. Try signing in with the new password first, or request a new reset link.");
        return;
      }
      window.location.replace("/login?reset=1");
    } catch {
      setError("The server could not be reached to confirm your password change. Try signing in with the new password first, or request a new reset link.");
    } finally {
      window.clearTimeout(timer);
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="password">
          New password
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
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={10}
          className="input mt-1"
          autoComplete="new-password"
        />
      </div>
      {error && (
        <div role="alert" className="space-y-2 text-sm text-risk">
          <p>{error}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className="tap underline">Sign in</Link>
            <Link href="/forgot-password" className="tap underline">Request a new reset link</Link>
          </div>
        </div>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving..." : "Update password"}
      </button>
    </form>
  );
}
