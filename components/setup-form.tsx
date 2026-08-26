"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SetupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: name || null }),
    });
    if (res.ok) {
      router.push("/today");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Setup failed. Try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        {/*
          * Every label here rendered on screen and was tied to nothing, so
          * a screen reader met four blank boxes on the screen that creates
          * the first account on a deployment. Same defect as the sign-in
          * form, and invisible for the same reason.
          */}
        <label className="label" htmlFor="setup-name">
          Your name
        </label>
        <input
          id="setup-name"
          type="text"
          className="input mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional"
          autoComplete="name"
        />
      </div>
      <div>
        <label className="label" htmlFor="setup-email">
          Email
        </label>
        <input
          id="setup-email"
          type="email"
          className="input mt-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="setup-password">
          Password
        </label>
        <input
          id="setup-password"
          type="password"
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p className="mt-1 text-xs text-muted-foreground">At least 12 characters.</p>
      </div>
      <div>
        <label className="label" htmlFor="setup-confirm">
          Confirm password
        </label>
        <input
          id="setup-confirm"
          type="password"
          className="input mt-1"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      {error && <p className="text-sm text-risk">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Creating account…" : "Create account & sign in"}
      </button>
    </form>
  );
}
