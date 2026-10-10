import { storedTimestamp } from "@/lib/domain/stored-timestamp";

/** A stored instant, independent of the server and browser timezone. */
export function StoredTime({ value, seconds = false, className, title }: {
  value: string | Date | null | undefined;
  seconds?: boolean;
  className?: string;
  title?: string;
}) {
  const recorded = storedTimestamp(value, { seconds });
  return <time dateTime={recorded.dateTime} className={className} title={title}>{recorded.label}</time>;
}
