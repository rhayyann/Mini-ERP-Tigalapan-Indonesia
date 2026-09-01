"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useG2GStore } from "@/lib/g2g/store";
import { deriveG2G } from "@/lib/g2g/derive";
import { GateStatusbar } from "@/components/gate-statusbar";
import { StageCard } from "@/components/stage-card";
import { StatusPill } from "@/components/ui/status-pill";
import { ProgressBar } from "@/components/ui/progress-bar";

export default function GateToGatePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const state = useG2GStore();
  const { advance, rejectAction, altAction, reset, setView } = state;

  if (!mounted) return null;

  const vm = deriveG2G(state);

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      {/* Top navbar */}
      <div className="flex h-[52px] flex-none items-center gap-[14px] bg-surface-nav px-[22px]">
        <span className="rounded-[5px] bg-accent-blue" style={{ width: 22, height: 22 }} />
        <span className="font-sans text-[13px] font-bold text-white">ERP Tigalapan Indonesia</span>
        <span className="h-5 w-px bg-white/16" />
        <span className="font-sans text-[12.5px] font-medium text-[#9FB0C0]">Gate-to-Gate · simulasi data dummy</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11.5px] text-[#7E93A8]">role aktif: {vm.activeRole}</span>
          <button
            onClick={reset}
            className="rounded-[5px] border border-white/22 bg-transparent px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-[#C6D3DF]"
          >
            Reset simulasi
          </button>
        </span>
      </div>

      {/* PO header */}
      <div className="border-b border-border-subtle bg-surface-card px-[22px] pt-4">
        <div className="flex items-start gap-4">
          <div>
            <div className="font-sans text-xs text-[#94A3B0]">Purchase Order Maklon</div>
            <div className="mt-0.5 font-sans text-[22px] font-bold text-text-primary">PO-MKL-001 · PT Maklon ABC</div>
            <div className="mt-1 flex gap-[14px] font-sans text-[11.5px] text-text-muted">
              <span>
                Qty <b className="font-mono text-[#31414F]">{vm.qtyLabel}</b> pcs
              </span>
              <span>Pola A, B</span>
              <span>
                Target <b className="font-mono text-[#31414F]">20/09/2026</b>
              </span>
              <span>Entitas PT Tigalapan Sukses Indo</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-[18px]">
            <div className="text-right">
              <div className="font-sans text-[10.5px] uppercase tracking-wider text-[#94A3B0]">Progress gate</div>
              <div className="font-mono text-xl font-bold text-text-primary">{vm.progressLabel}</div>
            </div>
            <div className="text-right">
              <div className="font-sans text-[10.5px] uppercase tracking-wider text-[#94A3B0]">SLA terpakai</div>
              <div className="font-mono text-xl font-bold text-warning-fg">{vm.slaUsedLabel}</div>
            </div>
            <div className="text-right">
              <div className="font-sans text-[10.5px] uppercase tracking-wider text-[#94A3B0]">Status PO</div>
              <div className="mt-0.5">
                <StatusPill tone={vm.poStatusTone}>{vm.poStatus}</StatusPill>
              </div>
            </div>
          </div>
        </div>
        <GateStatusbar phases={vm.phases} onSelect={setView} />
      </div>

      {/* Body */}
      <div className="grid flex-1 items-start gap-4 px-[22px] pb-[26px] pt-[18px]" style={{ gridTemplateColumns: "1fr 372px" }}>
        <div className="flex min-w-0 flex-col gap-[14px]">
          {/* Next action bar */}
          <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-[14px]">
            <div className="min-w-0">
              <div className="font-sans text-[13px] font-semibold text-text-primary">{vm.nextActionTitle}</div>
              <div className="mt-0.5 font-sans text-[11.5px] leading-[1.45] text-text-muted">{vm.nextActionHint}</div>
            </div>
            <div className="ml-auto flex flex-none gap-2">
              {vm.hasAlt && (
                <button onClick={altAction} className="rounded-md border border-[#EFC9C4] bg-white px-[14px] py-[9px] font-sans text-xs font-semibold text-danger-fg">
                  {vm.altLabel}
                </button>
              )}
              {vm.canReject && (
                <button onClick={rejectAction} className="rounded-md border border-[#CBD5DF] bg-white px-[14px] py-[9px] font-sans text-xs font-semibold text-action-primary">
                  Kembalikan
                </button>
              )}
              <button
                onClick={advance}
                disabled={vm.primaryDisabled}
                className={cn(
                  "rounded-md border-0 px-[15px] py-[9px] font-sans text-xs font-semibold text-white",
                  vm.primaryDisabled ? "cursor-default bg-[#A9B5C1]" : "bg-action-primary"
                )}
              >
                {vm.primaryLabel}
              </button>
            </div>
          </div>

          {/* Stage cards */}
          <div>
            <div className="mb-[9px] flex items-baseline gap-[9px]">
              <div className="font-sans text-[13px] font-semibold text-text-primary">{vm.phaseTitle}</div>
              <div className="font-sans text-[11.5px] text-text-muted">{vm.phaseSubtitle}</div>
            </div>
            <div className="grid gap-[14px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {vm.stageCards.map((g) => (
                <StageCard key={g.id} g={g} />
              ))}
            </div>
          </div>

          {/* Line items */}
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="flex items-center border-b border-border-subtle px-4 py-3">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Line items</span>
              <span className="ml-auto font-mono text-[11px] text-text-muted">{vm.itemsSummary}</span>
            </div>
            <div
              className="grid border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "90px 1fr 92px 92px 92px 108px" }}
            >
              <span>Roll</span>
              <span>Pola / warna</span>
              <span className="text-right">Target</span>
              <span className="text-right">Cutting</span>
              <span className="text-right">FG</span>
              <span>Status</span>
            </div>
            {vm.items.map((it) => (
              <div
                key={it.roll}
                className="grid items-center border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]"
                style={{ gridTemplateColumns: "90px 1fr 92px 92px 92px 108px" }}
              >
                <span className="font-mono font-medium">{it.roll}</span>
                <span>{it.pola}</span>
                <span className="text-right font-mono">{it.target}</span>
                <span className="text-right font-mono">{it.cutting}</span>
                <span className="text-right font-mono">{it.fg}</span>
                <span className="justify-self-start">
                  <StatusPill tone={it.tone}>{it.status}</StatusPill>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-[14px]">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-[15px] py-3 font-sans text-[13px] font-semibold text-text-primary">SLA timeline · 13 gate</div>
            <div className="flex flex-col gap-0.5 px-[15px] py-3">
              {vm.timeline.map((t) => (
                <div key={t.gateId} className="grid items-center gap-[9px] py-[5px]" style={{ gridTemplateColumns: "18px 1fr 66px" }}>
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-full font-mono text-[8px] font-semibold",
                      t.mark === "done" ? "bg-success text-white" : t.mark === "active" ? "bg-accent-blue text-white" : "bg-border-subtle text-text-muted"
                    )}
                    style={{ width: 15, height: 15 }}
                  >
                    {t.mark === "done" ? "✓" : t.mark === "active" ? "●" : ""}
                  </span>
                  <span>
                    <span
                      className={cn(
                        "block font-sans text-[11.5px] font-medium",
                        t.nameTone === "done" ? "text-[#31414F]" : t.nameTone === "active" ? "text-text-primary" : "text-[#94A3B0]"
                      )}
                    >
                      {t.name}
                    </span>
                    <ProgressBar pct={t.barPct} tone={t.barTone} className="mt-1" height={4} />
                  </span>
                  <span className={cn("text-right font-mono text-[10.5px] font-medium", t.slaOver ? "text-danger-fg" : "text-text-muted")}>{t.slaText}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="flex items-center border-b border-border-subtle px-[15px] py-3">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Activity log</span>
              <span className="ml-auto font-mono text-[10.5px] text-[#94A3B0]">{vm.logCount}</span>
            </div>
            {vm.log.map((l, i) => (
              <div key={i} className="flex gap-[10px] border-b border-[#F1F4F7] px-[15px] py-[10px]">
                <span className="flex-none pt-0.5 font-mono text-[10.5px] text-[#94A3B0]">{l.time}</span>
                <span className="font-sans text-[11.5px] leading-[1.45] text-[#31414F]">{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
