import { LoadingRecovery } from "@/components/loading-recovery";
import { SkeletonBar, SkeletonCard, SkeletonHeader } from "@/components/skeleton";

/** Sketch of the call queue while cards load. */
export default function CallQueueLoading() {
  return (
    <div className="flex page-shell">
      <LoadingRecovery label="Loading call queue" />
      <SkeletonHeader />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          aria-hidden="true"
          className="scroll-thin w-full shrink-0 space-y-4 overflow-y-auto border-r border-border/55 p-4 dark:border-white/10 lg:w-[400px]"
        >
          <SkeletonBar className="h-11 w-full" />
          <SkeletonBar className="h-8 w-3/4" />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
        </section>
        <section aria-hidden="true" className="hidden min-w-0 flex-1 p-6 lg:block">
          <SkeletonCard lines={7} />
        </section>
      </div>
    </div>
  );
}
