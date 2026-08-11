"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SubFiltersProps {
  trade?: string;
  state?: string;
  minReliability?: string;
  q?: string;
}

/** Client-side filter bar for the Sub Database. Pushes query params via the router. */
export function SubFilters({ trade, state, minReliability, q }: SubFiltersProps) {
  const router = useRouter();
  const [qVal, setQVal] = useState(q ?? "");
  const [tradeVal, setTradeVal] = useState(trade ?? "");
  const [stateVal, setStateVal] = useState(state ?? "");
  const [minRel, setMinRel] = useState(minReliability ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (qVal.trim()) params.set("q", qVal.trim());
    if (tradeVal.trim()) params.set("trade", tradeVal.trim());
    if (stateVal.trim()) params.set("state", stateVal.trim().toUpperCase());
    if (minRel.trim()) params.set("minReliability", minRel.trim());
    const qs = params.toString();
    router.push(qs ? `/subs?${qs}` : "/subs");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") apply();
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface/40 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-end sm:px-5">
      <div className="min-w-0 flex-1 sm:min-w-[200px]">
        <label className="label mb-1 block" htmlFor="sub-q">
          Search
        </label>
        <input
          id="sub-q"
          className="input"
          placeholder="Company or owner name"
          value={qVal}
          onChange={(e) => setQVal(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:contents">
        <div className="min-w-0 sm:w-40">
          <label className="label mb-1 block" htmlFor="sub-trade">
            Trade
          </label>
          <input
            id="sub-trade"
            className="input"
            placeholder="e.g. Electrical"
            value={tradeVal}
            onChange={(e) => setTradeVal(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="min-w-0 sm:w-24">
          <label className="label mb-1 block" htmlFor="sub-state">
            State
          </label>
          <input
            id="sub-state"
            className="input"
            placeholder="TX"
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      <div className="w-full sm:w-32">
        <label
          className="label mb-1 block"
          htmlFor="sub-minrel"
          title="0 to 100. Based on how consistently this sub answers calls, quotes on time, and delivers."
        >
          Min reliability
        </label>
        <input
          id="sub-minrel"
          className="input"
          type="number"
          min={0}
          max={100}
          placeholder="0"
          value={minRel}
          onChange={(e) => setMinRel(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <button className="btn-primary flex-1 sm:flex-none" onClick={apply}>
          Apply
        </button>
        <Link href="/subs" className="btn-ghost flex-1 sm:flex-none">
          Clear
        </Link>
      </div>
    </div>
  );
}
