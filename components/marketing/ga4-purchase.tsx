"use client";
import { useEffect } from "react";
import { GA4_READY, ga4Purchase, type Ga4Purchase } from "@/lib/client/ga4";

export function Ga4PurchaseEvent({ purchase }: { purchase: Ga4Purchase }) {
  useEffect(() => {
    const report = () => { ga4Purchase(purchase); };
    report();
    window.addEventListener(GA4_READY, report);
    return () => window.removeEventListener(GA4_READY, report);
  }, [purchase]);
  return null;
}
