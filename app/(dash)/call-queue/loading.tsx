import { SkeletonCard, SkeletonHeader } from "@/components/skeleton";

/** Sketch of the call queue while cards load. */
export default function CallQueueLoading() {
  return (
    <div className="flex h-screen flex-col">
      <SkeletonHeader />
      <div className="flex-1 overflow-hidden p-5">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    </div>
  );
}
