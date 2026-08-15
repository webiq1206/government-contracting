import { toScannable } from "@/lib/domain/scannable";

/**
 * Render one block of analyst text the way it deserves.
 *
 * A list the analyst wrote as a paragraph comes back as bullets; a genuine
 * paragraph stays a paragraph. The decision is in lib/domain/scannable, so
 * every place that shows this kind of text makes it the same way.
 */
export function ScannableText({
  text,
  className = "",
  size = "sm",
}: {
  text: string | null | undefined;
  className?: string;
  size?: "sm" | "xs";
}) {
  const parsed = toScannable(text);
  if (!parsed) return null;

  const type = size === "xs" ? "text-xs" : "text-sm";

  if (parsed.kind === "bullets") {
    return (
      <ul className={`space-y-1 ${type} leading-snug ${className}`}>
        {parsed.items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p className={`whitespace-pre-line ${type} leading-relaxed ${className}`}>
      {parsed.text}
    </p>
  );
}
