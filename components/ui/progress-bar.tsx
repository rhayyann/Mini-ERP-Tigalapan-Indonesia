import { cn } from "@/lib/utils";

export type BarTone = "locked" | "active" | "done" | "over";

const TONE_CLASSES: Record<BarTone, string> = {
  locked: "bg-border-subtle",
  active: "bg-accent-blue",
  done: "bg-success",
  over: "bg-danger",
};

export function ProgressBar({ pct, tone, className, height = 5 }: { pct: number; tone: BarTone; className?: string; height?: number }) {
  return (
    <div className={cn("rounded-full bg-[#EEF1F4]", className)} style={{ height }}>
      <div className={cn("h-full rounded-full transition-all", TONE_CLASSES[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
