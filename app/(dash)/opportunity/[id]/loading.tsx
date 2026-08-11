import { SkeletonBar, SkeletonCard, SkeletonHeader } from "@/components/skeleton";

/** Sketch of the opportunity record while it loads. */
export default function OpportunityLoading() {
  return (
    <div className="flex page-shell">
      <SkeletonHeader />
      <div className="flex-1 overflow-hidden">
        <div className="px-5 pt-4">
          <SkeletonBar className="h-7 w-full max-w-2xl" />
        </div>
        <div className="px-5 pt-4">
          <SkeletonBar className="h-16 w-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
          <SkeletonCard lines={6} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </div>
  );
}
