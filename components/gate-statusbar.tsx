"use client";

import { cn } from "@/lib/utils";
import type { PhaseViewModel } from "@/lib/g2g/derive";

function clipPathFor(i: number, total: number) {
  if (i === 0) return "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)";
  if (i === total - 1) return "polygon(9px 0, 100% 0, 100% 100%, 9px 100%, 0 50%)";
  return "polygon(9px 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 9px 100%, 0 50%)";
}

export function GateStatusbar({ phases, onSelect }: { phases: PhaseViewModel[]; onSelect: (i: number) => void }) {
  return (
    <div className="mt-4 flex items-center overflow-hidden">
      {phases.map((ph, i) => (
        <button
          key={ph.index}
          onClick={() => onSelect(ph.index)}
          className={cn(
            "flex-1 border-0 text-left font-mono text-[11px] font-semibold tracking-wide",
            ph.allDone ? "bg-success text-white" : ph.isCurrent ? "bg-action-primary text-white" : "bg-[#EEF1F4] text-text-muted"
          )}
          style={{
            padding: i === 0 ? "10px 20px 10px 14px" : "10px 20px 10px 26px",
            marginLeft: i === 0 ? 0 : -9,
            clipPath: clipPathFor(i, phases.length),
            boxShadow: ph.isViewed ? "inset 0 -3px 0 rgba(255,255,255,.55)" : "none",
          }}
        >
          {ph.allDone ? "✓ " : ""}
          {ph.label}
        </button>
      ))}
    </div>
  );
}
