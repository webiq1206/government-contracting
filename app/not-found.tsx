import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="num text-5xl font-bold text-slate-300">404</p>
      <p className="text-slate-600">That page or record does not exist.</p>
      <Link href="/pipeline" className="btn-primary">
        Back to pipeline
      </Link>
    </main>
  );
}
