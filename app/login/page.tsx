import { redirect } from "next/navigation";
import { currentUser, hasAnyOperator } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { SessionLoadFailure } from "@/components/session-load-failure";

export const dynamic = "force-dynamic";

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
    <main className="relative flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-10 text-center">
          <p className="mb-4 text-sm text-muted-foreground">Your government contracting workspace</p>
          <h1 className="flex justify-center">
            <ThemeWordmark className="h-12" />
          </h1>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">Welcome back</h2>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          Federal opportunities, scored and briefed automatically. Sign in to review
          today&rsquo;s pipeline.
        </p>
      </div>
    </main>
  );
}
