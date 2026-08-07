/**
 * Loading-skeleton primitives. Each page's loading.tsx sketches its real
 * layout with these so navigation feels instant instead of flashing blank.
 * Server-safe (no client JS), animated with Tailwind's pulse.
 */

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export function SkeletonRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonBar className="h-4 w-2/3" />
        <SkeletonBar className="h-3 w-1/3" />
      </div>
      <SkeletonBar className="h-6 w-24 shrink-0" />
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBar key={i} className={`h-4 ${i === 0 ? "w-3/4" : i === lines - 1 ? "w-1/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonHeader() {
  return (
    <div className="border-b border-border bg-background px-5 py-4">
      <SkeletonBar className="h-8 w-44" />
      <SkeletonBar className="mt-2 h-3.5 w-72" />
    </div>
  );
}
