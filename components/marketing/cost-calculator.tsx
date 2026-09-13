"use client";
import { useId, useState } from "react";
import { planPrice } from "@/lib/billing/catalog";
import { estimateMonthlyValue } from "@/lib/domain/marketing-cost";
export function CostCalculator() {
  const id = useId();
  const [values, setValues] = useState({
    bids: "",
    hours: "",
    hourlyCost: "",
    serviceCost: "",
  });
  const [interval, setInterval] = useState("month");
  const subscription =
    planPrice("standard", interval === "year" ? "year" : "month").amountUsd /
    (interval === "year" ? 12 : 1);
  const ready = Object.values(values).every((value) => value.trim() !== "");
  const result = ready
    ? estimateMonthlyValue({
        bids: Number(values.bids),
        hours: Number(values.hours),
        hourlyCost: Number(values.hourlyCost),
        serviceCost: Number(values.serviceCost),
        subscription,
      })
    : null;
  const money = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  const fields = [
    ["bids", "Bids pursued per month", "e.g. 4"],
    ["hours", "Hours you expect to save per bid", "Your estimate"],
    ["hourlyCost", "Your team's hourly cost ($)", "Your estimate"],
    ["serviceCost", "Estimated monthly service costs ($)", "Enter 0 if none"],
  ] as const;
  return (
    <div className="bco-calculator">
      <div>
        <div className="bco-calculator-inputs">
          {fields.map(([key, label, placeholder]) => (
            <label key={key} htmlFor={`${id}-${key}`}>
              {label}
              <input
                id={`${id}-${key}`}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={values[key]}
                placeholder={placeholder}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
          <label htmlFor={`${id}-interval`}>
            Subscription basis
            <select
              id={`${id}-interval`}
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            >
              <option value="month">Standard monthly</option>
              <option value="year">Standard annual, averaged monthly</option>
            </select>
          </label>
        </div>
        <p className="bco-caption" style={{ marginTop: 20 }}>
          Use your own assumptions. Include provider charges and any platform
          usage markup. Taxes and setup time are not included. Annual
          subscription is paid upfront.
        </p>
      </div>
      <div
        className="bco-calculator-result"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="bco-kicker">Estimated monthly value after costs</p>
        {result ? (
          <>
            <p
              className={`bco-price ${result.netValue < 0 ? "bco-negative" : ""}`}
            >
              {money(result.netValue)}
            </p>
            <p>
              {result.netValue > 0
                ? "Your estimated time value exceeds the modeled cost."
                : result.netValue < 0
                  ? "Your estimated time value does not cover the modeled cost."
                  : "Your estimated time value equals the modeled cost."}
            </p>
            <dl>
              <div>
                <dt>Time value ({result.hoursSaved.toLocaleString()} hours)</dt>
                <dd>{money(result.laborValue)}</dd>
              </div>
              <div>
                <dt>Subscription + service costs</dt>
                <dd>{money(result.totalCost)}</dd>
              </div>
            </dl>
            <p>
              {result.breakEvenHours === null
                ? "Enter an hourly cost above zero to calculate break-even hours."
                : `You would need to save about ${result.breakEvenHours.toFixed(1)} hours per month to cover these costs.`}
            </p>
          </>
        ) : (
          <>
            <p className="bco-price">Your numbers.</p>
            <p>
              {ready
                ? "Enter valid nonnegative amounts to calculate an estimate."
                : "Fill in the four fields to see how the cost compares with the time you expect to save."}
            </p>
          </>
        )}
        <p className="bco-caption" style={{ marginTop: 20 }}>
          This is a planning estimate, not a promise of time savings, cash
          savings, or contract wins.
        </p>
      </div>
    </div>
  );
}
