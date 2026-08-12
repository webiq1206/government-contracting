import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Choose a new password | Brost Co",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token = searchParams?.token ?? "";
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="eyebrow mb-3">Autonomous Procurement Execution</p>
          <h1 className="flex justify-center">
            <Link href="/">
              <ThemeWordmark className="h-12" />
            </Link>
          </h1>
          <div className="mx-auto mt-4 h-px w-12 bg-accent" />
        </div>

        <h2 className="font-display text-2xl text-foreground">Choose a new password</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a new password for your account. You will sign in on the next screen.
        </p>
        <div className="card mt-6">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <p className="text-sm text-risk">
              This reset link is missing a token. Request a new one from{" "}
              <Link href="/forgot-password" className="underline">
                forgot password
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
