/** Lightweight skeleton shown while a dashboard page's data loads. */
export default function DashboardLoading() {
  return (
    <div className="bg-background p-5 text-foreground">
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted/70" />
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="card">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-muted/70" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
