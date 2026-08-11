import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password | Brost Co",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display text-xl">
          BROST <span className="font-accent">CO</span>
        </Link>
        <h1 className="mt-6 font-display text-3xl">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter your account email and we will send a reset link if it matches an
          account.
        </p>
        <div className="card mt-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">
          <Link href="/login" className="text-accent hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
