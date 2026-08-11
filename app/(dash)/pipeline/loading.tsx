import { SkeletonBar, SkeletonCard, SkeletonHeader } from "@/components/skeleton";

/** Sketch of the pipeline's four-lane layout while data loads. */
export default function PipelineLoading() {
  return (
    <div className="flex page-shell">
      <SkeletonHeader />
      <div className="flex-1 overflow-hidden p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, lane) => (
            <div key={lane} className="space-y-2">
              <SkeletonBar className="h-5 w-32" />
              <SkeletonCard />
              {lane < 2 && <SkeletonCard />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
