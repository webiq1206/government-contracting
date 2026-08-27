import { shortenAgency } from "@/lib/domain/agency-path";

/**
 * The buying office, short enough to scan and complete enough to be true.
 *
 * The visible text is the most specific level, because that is what tells one
 * row from another. The whole path is in the DOM for a screen reader, and in
 * the title for a mouse, so nothing is hover-only: a touch user reading the
 * row hears or sees the same office name a mouse user does.
 */
export function AgencyPath({
  agency,
  subAgency,
  className = "",
}: {
  agency: string | null | undefined;
  subAgency?: string | null;
  className?: string;
}) {
  const { short, full, shortened, hidden } = shortenAgency(agency, subAgency);
  return (
    <span className={className} title={shortened ? full : undefined}>
      {short}
      {shortened && (
        // The levels above, read aloud but not drawn. CSS truncation hides
        // nothing from a screen reader; this is here because the shortening
        // above is done in JavaScript, which does.
        <span className="sr-only">
          , within {full} ({hidden} {hidden === 1 ? "level" : "levels"} above)
        </span>
      )}
    </span>
  );
}
