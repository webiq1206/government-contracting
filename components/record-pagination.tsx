import Link from "next/link";
import { recordPage } from "@/lib/domain/record-pagination";
export function RecordPagination({ total, value, query, pageKey, label, size = 12 }: {
  total: number; value: unknown; query: string; pageKey: string; label: string; size?: number;
}) {
  const p = recordPage(total, value, size);
  if (p.pages <= 1) return null;
  const href = (page: number) => {
    const params = new URLSearchParams(query);
    params.delete("peek");
    params.set(pageKey, String(page));
    return `/pipeline?${params}`;
  };
  return <nav aria-label={`${label} pages`} className="my-3 flex flex-wrap items-center gap-2 text-xs">
    <span role="status" className="mr-auto text-muted-foreground">{p.start + 1} to {p.end} of {total}</span>
    {p.page > 1 && <Link href={href(p.page - 1)} className="btn-secondary min-h-11" aria-label={`Previous ${label.toLowerCase()}`}>Previous</Link>}
    {p.page < p.pages && <Link href={href(p.page + 1)} className="btn-secondary min-h-11" aria-label={`Next ${label.toLowerCase()}`}>Next</Link>}
  </nav>;
}
