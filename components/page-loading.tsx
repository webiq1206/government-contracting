import { LoadingRecovery } from "./loading-recovery";

/** Shared route fallback that remains legible before page data is available. */
export function PageLoading({ label = "Loading your workspace" }: { label?: string }) {
  return (
    <div className="min-w-0 flex-1 bg-background p-5 text-foreground sm:p-6">
      <LoadingRecovery label={label} />
      <div className="mt-6 space-y-4" aria-hidden="true">
        {["w-2/3", "w-full", "w-5/6"].map((width) => (
          <div key={width} className={`h-16 max-w-3xl animate-pulse rounded-lg bg-muted motion-reduce:animate-none ${width}`} />
        ))}
      </div>
    </div>
  );
}
