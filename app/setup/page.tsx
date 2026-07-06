import { redirect } from "next/navigation";
import { currentUser, hasAnyOperator } from "@/lib/auth";
import { SetupForm } from "@/components/setup-form";

export const dynamic = "force-dynamic";

/**
 * First-run setup. Creates the initial operator account on a fresh deployment
 * (empty users table). If an operator already exists, sends the visitor to the
 * normal login page — this route is only reachable once.
 */
export default async function SetupPage() {
  const user = await currentUser().catch(() => null);
  if (user) redirect("/today");
  if (await hasAnyOperator()) redirect("/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="eyebrow mb-3">Autonomous Procurement Execution</p>
          <h1 className="font-serif text-5xl font-semibold tracking-tight text-foreground">
            BROSTCO
          </h1>
          <div className="mx-auto mt-4 h-px w-12 bg-accent" />
          <p className="mt-6 text-sm text-slate-500">
            First-run setup. Create the operator account that will sign in to review
            today&rsquo;s pipeline.
          </p>
        </div>
        <SetupForm />
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          You&rsquo;ll see this screen only once. After setup, sign in at{" "}
          <span className="font-mono text-slate-400">/login</span>.
        </p>
      </div>
    </main>
  );
}
