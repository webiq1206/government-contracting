import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display text-xl">
          BROST <span className="font-accent">CO</span>
        </Link>
        <h1 className="mt-6 font-display text-3xl">Choose a new password</h1>
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
    </div>
  );
}
