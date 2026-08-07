import { SkeletonBar, SkeletonHeader, SkeletonRow } from "@/components/skeleton";

/** Sketch of the Today layout while its data loads. */
export default function TodayLoading() {
  return (
    <div className="flex h-screen flex-col">
      <SkeletonHeader />
      <div className="flex-1 overflow-hidden p-5">
        <div className="mx-auto w-full max-w-5xl space-y-8">
          <SkeletonBar className="h-10 w-full" />
          <SkeletonBar className="h-24 w-full" />
          <div className="space-y-2">
            <SkeletonBar className="h-7 w-56" />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
          <div className="space-y-2">
            <SkeletonBar className="h-7 w-40" />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </div>
      </div>
    </div>
  );
}
