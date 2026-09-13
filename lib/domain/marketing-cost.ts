/** Buyer-entered estimates, not product performance claims. No billing side effects. */
export function estimateMonthlyValue(input: {
  bids: number;
  hours: number;
  hourlyCost: number;
  serviceCost: number;
  subscription: number;
}) {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const hoursSaved = input.bids * input.hours;
  const laborValue = hoursSaved * input.hourlyCost;
  const totalCost = input.subscription + input.serviceCost;
  if (![hoursSaved, laborValue, totalCost].every(Number.isFinite)) return null;
  return {
    hoursSaved,
    laborValue,
    totalCost,
    netValue: laborValue - totalCost,
    breakEvenHours: input.hourlyCost > 0 ? totalCost / input.hourlyCost : null,
  };
}
