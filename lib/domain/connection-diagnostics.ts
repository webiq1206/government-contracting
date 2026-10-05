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
