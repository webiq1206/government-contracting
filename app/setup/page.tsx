import { redirect } from "next/navigation";
import { currentUser, hasAnyOperator } from "@/lib/auth";
import { SetupForm } from "@/components/setup-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

/**
 * First-run setup. Creates the initial operator account on a fresh deployment
 * (empty users table). If an operator already exists, sends the visitor to the
 * normal login page, this route is only reachable once.
 */
export default async function SetupPage() {
  const user = await currentUser().catch(() => null);
  if (user) redirect("/today");
  if (await hasAnyOperator()) redirect("/login");

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="eyebrow mb-3">Autonomous Procurement Execution</p>
          <h1 className="flex justify-center">
            <ThemeWordmark className="h-12" />
          </h1>
          <div className="mx-auto mt-4 h-px w-12 bg-accent" />
          <p className="mt-6 text-sm text-muted-foreground">
            First-run setup. Create the operator account that will sign in to review
            today&rsquo;s pipeline.
          </p>
        </div>
        <SetupForm />
        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          You&rsquo;ll see this screen only once. After setup, sign in at{" "}
          <span className="font-mono text-muted-foreground">/login</span>.
        </p>
      </div>
    </main>
  );
}
