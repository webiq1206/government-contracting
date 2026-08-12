/** Stripe availability without importing the Stripe SDK (keeps local/dev bootable). */

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
