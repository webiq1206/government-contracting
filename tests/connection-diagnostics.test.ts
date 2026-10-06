import { describe, expect, it } from "vitest";
import { callbackDiagnostic, connectionFailureReason, connectionFailureMessage } from "../lib/domain/connection-diagnostics";

describe("read-only callback diagnostics", () => {
  it("classifies callback failures without reflecting raw provider data", () => {
    expect(connectionFailureReason(new Error("redirect_uri_mismatch secret=private"))).toBe("callback_mismatch");
    expect(connectionFailureReason("invalid_client")).toBe("client_configuration");
    expect(connectionFailureReason("access_denied")).toBe("access_denied");
    const reason = connectionFailureReason(new Error("Bearer private token"));
    expect(reason).toBe("unconfirmed");
    expect(connectionFailureMessage(reason)).toContain("may have been saved");
    expect(connectionFailureMessage("Bearer private token")).not.toContain("private");
  });
  it("preserves the exact deployed URI without claiming verified registration", () => {
    const uri = "https://brostco.com/api/services/google/callback";
    expect(callbackDiagnostic(uri, true)).toMatchObject({ callbackUrl: uri, credentialsPresent: true, registrationVerified: false, issue: null });
  });
  it.each(["invalid", "https://brostco.com//api/services/google/callback", "https://brostco.com/callback?wrong=1", "http://brostco.com/callback", "https://user:password@brostco.com/callback"])("flags malformed setup %s without silently repairing it", uri => {
    expect(callbackDiagnostic(uri, false)).toMatchObject({ callbackUrl: uri, credentialsPresent: false, registrationVerified: false });
    expect(callbackDiagnostic(uri, false).issue).toBeTruthy();
  });
  it("allows localhost development while distinguishing missing credentials", () => {
    expect(callbackDiagnostic("http://localhost:3000/api/services/google/callback", false)).toMatchObject({ issue: null, credentialsPresent: false });
  });
});
