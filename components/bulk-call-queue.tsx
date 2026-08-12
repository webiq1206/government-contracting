"use client";

import type { CallCardRow } from "@/lib/data";
import { CallCard } from "@/components/call-card";
import {
  BulkActionBar,
  BulkSelectAllCheckbox,
  BulkSelectCheckbox,
  BulkSelectionProvider,
} from "@/components/bulk-selection";

export function BulkCallQueue({
  cards,
  openId,
}: {
  cards: CallCardRow[];
  openId?: string;
}) {
  const ids = cards.map((c) => c.id);
  return (
    <BulkSelectionProvider ids={ids}>
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <BulkSelectAllCheckbox label={`Select all ${cards.length} calls`} />
          <p className="text-xs text-muted-foreground">
            Select calls to skip or snooze together
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cards.map((c) => (
            <CallCard
              key={c.id}
              c={c}
              autoOpen={c.id === openId}
              selectControl={
                <BulkSelectCheckbox id={c.id} label={`Select ${c.company_name}`} />
              }
            />
          ))}
        </div>
      </div>
      <BulkActionBar
        noun="call"
        actions={[
          { kind: "skip_calls", label: "Skip" },
          { kind: "snooze_calls" },
        ]}
      />
    </BulkSelectionProvider>
  );
}
