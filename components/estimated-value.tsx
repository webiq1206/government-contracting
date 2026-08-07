import { currency } from "@/lib/format";

/**
 * Renders a dollar value with an honest qualifier: "(estimated)" whenever the
 * figure did NOT come from the source's own published field, so a regex
 * guess or the AI's reading of the attachments is never mistaken for an
 * official published amount. Every screen that shows an opportunity's value
 * should render it through this component.
 */
export function EstimatedValue({
  value,
  source,
  className,
}: {
  value: number | null | undefined;
  source?: string | null;
  className?: string;
}) {
  if (value == null) return <span className={className}>-</span>;
  const isEstimate = source === "extracted" || source === "analysis";
  return (
    <span className={className}>
      {currency(value)}
      {isEstimate && (
        <span
          className="ml-1 text-xs font-normal text-slate-500"
          title={
            source === "analysis"
              ? "Estimated by reading the solicitation and attachments; not a published figure."
              : "Estimated from the listing text; not a published figure."
          }
        >
          (estimated)
        </span>
      )}
    </span>
  );
}
