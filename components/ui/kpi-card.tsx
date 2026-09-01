import type { ReactNode } from "react";
import { LayoutGrid, Package, Factory, Building2, AlertTriangle, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiAccent = "blue" | "purple" | "orange" | "teal" | "danger" | "success";

const ACCENT_ICON_CLASSES: Record<KpiAccent, string> = {
  blue: "bg-info-bg text-accent-blue-2",
  purple: "bg-accent-purple-bg text-accent-purple",
  orange: "bg-accent-orange-bg text-accent-orange",
  teal: "bg-accent-teal-bg text-accent-teal",
  danger: "bg-danger-bg text-danger-fg",
  success: "bg-success-bg text-success-fg",
};

const ACCENT_VALUE_CLASSES: Record<KpiAccent, string> = {
  blue: "text-accent-blue-2",
  purple: "text-accent-purple",
  orange: "text-accent-orange",
  teal: "text-accent-teal",
  danger: "text-danger-fg",
  success: "text-success-fg",
};

const DEFAULT_ICONS: Record<KpiAccent, LucideIcon> = {
  blue: LayoutGrid,
  purple: Package,
  orange: Factory,
  teal: Building2,
  danger: AlertTriangle,
  success: CheckCircle2,
};

export function KpiCard({
  label,
  value,
  valueClassName,
  sub,
  subClassName,
  accent = "blue",
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  sub?: ReactNode;
  subClassName?: string;
  accent?: KpiAccent;
  icon?: LucideIcon;
  className?: string;
}) {
  const Icon = icon ?? DEFAULT_ICONS[accent];
  return (
    <div className={cn("rounded-[10px] border border-border-subtle bg-surface-card px-4 py-3.5", className)}>
      <div className="flex items-center justify-between">
        <div className="font-sans text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
        <div className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-[8px]", ACCENT_ICON_CLASSES[accent])}>
          <Icon size={16} strokeWidth={2.25} />
        </div>
      </div>
      <div className={cn("mt-3 font-mono text-[28px] font-bold leading-none tracking-tight", ACCENT_VALUE_CLASSES[accent], valueClassName)}>
        {value}
      </div>
      {sub && <div className={cn("mt-1.5 font-sans text-[11.5px] text-text-muted", subClassName)}>{sub}</div>}
    </div>
  );
}
