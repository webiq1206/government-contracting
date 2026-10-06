/** Public error categories only; never place a provider exception in a return URL. */
export function connectionFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/redirect_uri_mismatch|redirect.*mismatch/i.test(message)) return "callback_mismatch";
  if (/invalid_client|unauthorized_client/i.test(message)) return "client_configuration";
  if (/access_denied/i.test(message)) return "access_denied";
  return "unconfirmed";
}
export function connectionFailureMessage(reason: string | undefined): string {
  switch (reason) {
    case "callback_mismatch": return "The provider rejected the callback address. Compare the existing client registration with the exact callback shown in Sign-in setup details.";
    case "client_configuration": return "The provider did not accept the existing app registration. Ask the administrator to review its configuration.";
    case "access_denied": return "Access was declined. Review the saved connection status before starting sign-in again.";
    default: return "The connection could not be confirmed. It may have been saved. Reload the saved status before trying again; setup details below may help explain the problem.";
  }
}
/** Configuration evidence only. It cannot establish provider access or matching registration. */
export function callbackDiagnostic(callbackUrl: string, configured: boolean) {
  let issue: string | null = null;
  try {
    const url = new URL(callbackUrl);
    if (url.username || url.password || url.search || url.hash || /\/\//.test(url.pathname)) {
      issue = "The callback address contains unexpected path or URL details. Ask the platform administrator to check APP_URL.";
    } else if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      issue = "The callback address needs HTTPS outside local development.";
    }
  } catch {
    issue = "The callback address is not a valid URL. Ask the platform administrator to check APP_URL.";
  }
  return {
    callbackUrl,
    credentialsPresent: configured,
    issue,
    registrationVerified: false as const,
    guidance: "The provider's existing OAuth client must list this exact callback address, including its path and trailing slash. Configuration alone does not verify a working connection. If sign-in reports redirect_uri_mismatch, ask the platform administrator to compare the existing client registration with this address.",
  };
}
