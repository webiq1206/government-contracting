import { redirect } from "next/navigation";
import { currentUser, hasAnyOperator } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { Wordmark } from "@/components/wordmark";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser().catch(() => null);
  if (user) redirect("/today");
  // Fresh deployment with no operator yet: send them straight to first-run setup
  // rather than a login form that can't succeed.
  if (!(await hasAnyOperator())) redirect("/setup");
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="eyebrow mb-3">Autonomous Procurement Execution</p>
          <h1 className="flex justify-center">
            <Wordmark className="h-12" />
          </h1>
          <div className="mx-auto mt-4 h-px w-12 bg-accent" />
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          Federal opportunities, scored and briefed automatically. Sign in to review
          today&rsquo;s pipeline.
        </p>
      </div>
    </main>
  );
}
