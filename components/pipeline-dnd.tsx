"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";

/**
 * Drag-and-drop for the stages board.
 *
 * Two thin client wrappers around server-rendered content: DraggableCard
 * makes a card carry its opportunity id, StageDropColumn accepts a drop and
 * calls the same move action the card menu uses, so a drag and a menu tap
 * are one code path on the server. The server decides what the move means,
 * re-runs the target stage's agents, and refuses illegal targets; refusals
 * surface as a toast rather than a silent snap-back.
 *
 * Pointer-only by design: touch devices use the card menu's "Move to" chips,
 * which do the same thing without long-press gymnastics.
 */
export function DraggableCard({
  opportunityId,
  children,
}: {
  opportunityId: string;
  children: ReactNode;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/opportunity-id", opportunityId);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

export function StageDropColumn({
  stage,
  children,
}: {
  stage: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function drop(opportunityId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", stage }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        requeued?: string[];
      };
      if (!res.ok) {
        push({ message: data.error ?? "That move is not allowed." });
        return;
      }
      push({
        message: data.requeued?.length
          ? `Moved. Re-running: ${data.requeued.join(", ").replace(/-/g, " ")}.`
          : "Moved.",
      });
      router.refresh();
    } catch {
      push({ message: "Network error; the card was not moved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/opportunity-id");
        if (id && !busy) void drop(id);
      }}
      className={`flex min-h-0 flex-1 flex-col rounded-md transition-colors ${
        over ? "bg-gold/10 outline-dashed outline-1 outline-gold/60" : ""
      }`}
    >
      {children}
    </div>
  );
}
