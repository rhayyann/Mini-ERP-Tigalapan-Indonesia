import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "info" | "success" | "warning" | "danger" | "rework" | "locked" | "active" | "done";

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: "bg-[#EEF0F3] text-[#4B5B6B]",
  locked: "bg-[#EEF0FC] text-[#4A4FB0]",
  active: "bg-[#E7F5F5] text-[#1F6E6E]",
  done: "bg-success-bg text-success-fg",
  info: "bg-info-bg text-info-fg",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
  rework: "bg-rework-bg text-rework-fg",
};

export function StatusPill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold leading-none",
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
