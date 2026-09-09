import { AsyncLocalStorage } from "node:async_hooks";
export type UsageContext = {
  feature?: string;
  workflow?: string;
  relatedId?: string;
  userId?: string;
};
const context = new AsyncLocalStorage<UsageContext>();
export function withApiUsageContext<T>(value: UsageContext, fn: () => T): T {
  return context.run({ ...context.getStore(), ...value }, fn);
}
export function apiUsageContext(): UsageContext {
  return context.getStore() ?? {};
}
