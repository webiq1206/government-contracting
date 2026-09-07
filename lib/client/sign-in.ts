export type SignInResult = { ok: true } | { ok: false; error: string };

/** No credentials are logged or retained; interrupted requests stay retryable. */
export async function requestSignIn(email: string, password: string): Promise<SignInResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok === true) return { ok: true };
    return {
      ok: false,
      error: typeof data?.error === "string" && data.error.trim()
        ? data.error
        : response.status === 401
          ? "Email or password was not accepted. Check both fields and try again."
          : "Sign-in could not be confirmed. Please try again after the connection recovers.",
    };
  } catch {
    return {
      ok: false,
      error: controller.signal.aborted
        ? "Sign-in took too long to confirm. Check your connection, then try again."
        : "The sign-in service could not be reached. Check your connection, then try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}
