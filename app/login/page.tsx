import { redirect } from "next/navigation";
import { currentUser, hasAnyOperator } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { SessionLoadFailure } from "@/components/session-load-failure";
import { AuthSplit } from "@/components/auth-split";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in", robots: { index: false, follow: false } };

export default async function LoginPage() {
  const auth = await currentUser().then(
    (user) => ({ ok: true as const, user }),
    (error) => {
      console.error("[login] existing session could not be checked:", error);
      return { ok: false as const, user: null };
    }
  );
  if (!auth.ok) return <SessionLoadFailure />;
  const user = auth.user;
  if (user) redirect("/today");
  // Fresh deployment with no operator yet: send them straight to first-run setup
  // rather than a login form that can't succeed.
  if (!(await hasAnyOperator())) redirect("/setup");
  return (
    <AuthSplit
      kicker="Government contracting"
      headline={
        <>
          A clear brief
          <br />
          before the bid.
        </>
      }
      support="Opportunities scored and ready to review. The final call stays with your team."
      footer="Built for government contractors."
    >
      <p className="auth-kicker">Your BrostCo workspace</p>
      <h1 className="auth-title">Welcome back.</h1>
      <p className="auth-lede">
        Federal opportunities, scored and briefed automatically. Sign in to review
        today&apos;s pipeline.
      </p>
      <div className="auth-form">
        <LoginForm />
      </div>
      <p className="auth-secure">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="1.5" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        A private session on this device.
      </p>
    </AuthSplit>
  );
}
