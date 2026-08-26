import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Forgot password | Brost Co",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
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

        <h2 className="font-display text-2xl text-foreground">Reset your password</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your account email and we will send a reset link if it matches an
          account.
        </p>
        <div className="card mt-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-accent hover:underline md:min-h-0"
          >
            Back to login
          </Link>
        </p>
      </div>
    </main>
  );
}
