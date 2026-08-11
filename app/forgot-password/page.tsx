import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { Wordmark } from "@/components/wordmark";

export const metadata: Metadata = {
  title: "Forgot password | Brost Co",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="eyebrow mb-3">Autonomous Procurement Execution</p>
          <h1 className="flex justify-center">
            <Link href="/">
              <Wordmark className="h-12" />
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
          <Link href="/login" className="text-accent hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </main>
  );
}
