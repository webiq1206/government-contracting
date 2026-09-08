import Link from "next/link";

/** Visible evidence that a shell counter is unknown, not zero. */
export function ShellDataWarning({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="border-b border-review/50 bg-review/10 px-4 py-2.5 text-sm text-foreground">
      <span className="font-semibold">Some live status could not be checked:</span>{" "}
      {items.join(" ")}{" "}
      <Link href="/agents" className="font-semibold text-accent hover:underline">
        Open Automation Health
      </Link>
      {" or reload this page."}
    </div>
  );
}
