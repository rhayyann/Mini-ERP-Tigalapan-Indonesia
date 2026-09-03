"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { ProductionCuttingTab } from "@/components/mrp/production-cutting-tab";
import { ProductionResultPanel } from "@/components/mrp/production-result-panel";
import { ProductionReworkTab } from "@/components/mrp/production-rework-tab";
import { ProductionFinalTab } from "@/components/mrp/production-final-tab";
import { useMrpStore } from "@/lib/mrp/store";
import { countCuttingAwaitingUpdate, countFgShortfallGroups, countProductionFinalReady, countRejectActionableGroups, countRemainingRework } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

type Tab = "CUTTING" | "FG" | "REJECT" | "REWORK" | "FINAL";

function ProductionContent({ vendorId }: { vendorId: string }) {
  const [tab, setTab] = useState<Tab>("CUTTING");

  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const invoices = useMrpStore((s) => s.invoices);

  const cuttingBadge = countCuttingAwaitingUpdate(vendorId, productionBatches, invoices);
  const fgBadge = countFgShortfallGroups(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);
  // Reject SENGAJA baru badge begitu Finish Good sudah mulai dilaporkan untuk grup itu — sebelum
  // ada input FG sama sekali, belum ada dasar bilang ada reject (lihat catatan di badges.ts).
  const rejectBadge = countRejectActionableGroups(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);
  const reworkBadge = countRemainingRework(vendorId, productionBatches, productionResults);
  const finalBadge = countProductionFinalReady(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);

  const TABS: { key: Tab; label: string; badge: number }[] = [
    { key: "CUTTING", label: "Cutting", badge: cuttingBadge },
    { key: "FG", label: "Finish Good", badge: fgBadge },
    { key: "REJECT", label: "Reject", badge: rejectBadge },
    { key: "REWORK", label: "Rework", badge: reworkBadge },
    { key: "FINAL", label: "Final Produksi", badge: finalBadge },
  ];

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/production"
      breadcrumb={["Dashboard", "Produksi"]}
      title="Produksi"
      subtitle="Cutting, finish good, reject, dan rework"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="flex gap-2 rounded-lg border border-border-subtle bg-surface-card p-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex items-center gap-1.5 rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold " +
              (tab === t.key ? "bg-action-primary text-white" : "text-text-muted hover:bg-[#F7F9FB]")
            }
          >
            {t.label}
            {t.badge > 0 && (
              <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "CUTTING" && <ProductionCuttingTab vendorId={vendorId} />}
      {tab === "FG" && <ProductionResultPanel vendorId={vendorId} kind="FG" title="Finish Good" />}
      {tab === "REJECT" && <ProductionResultPanel vendorId={vendorId} kind="REJECT" title="Reject" />}
      {tab === "REWORK" && <ProductionReworkTab vendorId={vendorId} />}
      {tab === "FINAL" && <ProductionFinalTab vendorId={vendorId} />}
    </AppShell>
  );
}

export default function VendorProductionPage() {
  return <VendorAuthGuard>{(vendorId) => <ProductionContent vendorId={vendorId} />}</VendorAuthGuard>;
}
