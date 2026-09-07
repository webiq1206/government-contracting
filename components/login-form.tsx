"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { requestSignIn } from "@/lib/client/sign-in";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    const result = await requestSignIn(email, password);
    if (result.ok) {
      router.push("/today");
      router.refresh();
    } else {
      setError(result.error);
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        {/*
          * htmlFor, not just visible text. Both of these labels rendered on
          * screen and were tied to nothing, so a screen reader announced two
          * blank text boxes on the page every customer has to pass through.
          * Invisible to sighted review, which is why the sweep now measures
          * signed-out pages: it used to sign in THROUGH this form without ever
          * looking at it.
          */}
        <label className="label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          className="input mt-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="label" htmlFor="login-password">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center text-xs font-medium text-accent-strong hover:underline lg:min-h-0"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="login-password"
          type="password"
          className="input mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error && <p role="alert" className="text-sm text-risk">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading} aria-busy={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        New here?{" "}
        <Link
          href="/signup"
          className="inline-flex min-h-11 items-center font-medium text-accent-strong hover:underline lg:min-h-0"
        >
          Start a subscription
        </Link>
      </p>
    </form>
  );
}
