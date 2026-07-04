import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser().catch(() => null);
  if (user) redirect("/pipeline");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-mono text-3xl font-bold tracking-tight text-white">BROSTCO</h1>
          <p className="mt-1 text-sm text-slate-400">Autonomous Procurement Execution</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-slate-500">
          Set OPERATOR_EMAIL and OPERATOR_PASSWORD_HASH in your environment, or seed a user with{" "}
          <code className="text-slate-400">npm run db:seed</code>.
        </p>
      </div>
    </main>
  );
}
