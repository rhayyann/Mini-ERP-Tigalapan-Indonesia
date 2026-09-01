import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { GateViewModel } from "@/lib/g2g/derive";

export function StageCard({ g }: { g: GateViewModel }) {
  const dotClass =
    g.tone === "done" ? "bg-success text-white" : g.tone === "active" ? "bg-accent-blue text-white" : "bg-border-subtle text-text-muted";
  const pillTone = g.tone === "done" ? "done" : g.tone === "active" ? "active" : "locked";

  return (
    <div
      className={cn(
        "rounded-lg bg-surface-card p-3.5",
        g.tone === "active" ? "border border-[#CFE0EF] shadow-[0_2px_10px_rgba(46,111,167,.13)]" : "border border-border-subtle",
        g.tone === "locked" && "opacity-[.72]"
      )}
      style={{
        borderTop: `2px solid ${g.tone === "done" ? "#1F8A55" : g.tone === "active" ? "#2E6FA7" : "#DDE4EB"}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className={cn("flex h-[19px] w-[19px] items-center justify-center rounded-full font-mono text-[9.5px] font-semibold", dotClass)}>
          {g.id}
        </span>
        <span className="font-sans text-[12.5px] font-semibold text-text-primary">{g.name}</span>
        <StatusPill tone={pillTone} className="ml-auto">
          {g.badge}
        </StatusPill>
      </div>
      <div className="mt-2 font-sans text-[11.5px] leading-[1.5] text-text-muted">{g.desc}</div>
      <div className="mt-3 flex gap-3">
        <div className="flex-1">
          <div className="font-sans text-[10px] uppercase tracking-wider text-[#94A3B0]">Penanggung jawab</div>
          <div className="font-sans text-[11.5px] font-medium text-[#31414F]">{g.role}</div>
        </div>
        <div className="flex-1">
          <div className="font-sans text-[10px] uppercase tracking-wider text-[#94A3B0]">SLA</div>
          <div className={cn("font-mono text-[11.5px] font-medium", g.slaOver ? "text-danger-fg" : g.tone === "done" ? "text-success-fg" : g.tone === "active" ? "text-info-fg" : "text-[#94A3B0]")}>
            {g.slaText}
          </div>
        </div>
      </div>
      <ProgressBar pct={g.barPct} tone={g.barTone} className="mt-2.5" />
      <div className="mt-2.5 border-t border-[#F1F4F7] pt-2.5 font-mono text-[11px] text-[#94A3B0]">{g.meta}</div>
    </div>
  );
}
