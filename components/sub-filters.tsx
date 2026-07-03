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
    <div className="flex flex-wrap items-end gap-3 border-b border-ink-800 bg-ink-900/40 px-5 py-3">
      <div className="min-w-[200px] flex-1">
        <label className="label mb-1 block" htmlFor="sub-q">
          Search
        </label>
        <input
          id="sub-q"
          className="input"
          placeholder="Company or owner…"
          value={qVal}
          onChange={(e) => setQVal(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="w-40">
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
      <div className="w-24">
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
      <div className="w-32">
        <label className="label mb-1 block" htmlFor="sub-minrel">
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
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={apply}>
          Apply
        </button>
        <Link href="/subs" className="btn-ghost">
          Clear
        </Link>
      </div>
    </div>
  );
}
