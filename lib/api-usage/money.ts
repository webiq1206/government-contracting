/** Convert decimal USD to trillionths without binary floating-point rounding. */
export function decimalUnits(value: string): bigint {
  if (!/^\d{1,12}(?:\.\d{1,12})?$/.test(value))
    throw new Error(
      "Enter a positive dollar amount with at most 12 decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
}
export function invoiceCents(value: string): number {
  const cents = (decimalUnits(value) + 5_000_000_000n) / 10_000_000_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount is too large.");
  return Number(cents);
}
export function validateCost(value: string): string {
  decimalUnits(value);
  return value;
}
