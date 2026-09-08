"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    const confirm = String(fd.get("confirm") || "");
    if (password !== confirm) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          data.error ||
            "Your password was not changed. Check your connection and try again, or request a new reset link."
        );
        setPending(false);
        return;
      }
      router.push("/login?reset=1");
    } catch {
      setError(
        "The server could not be reached, so your password was not changed. Check your connection and try again."
      );
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
        <p role="alert" className="text-sm text-risk">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Saving..." : "Update password"}
      </button>
    </form>
  );
}
