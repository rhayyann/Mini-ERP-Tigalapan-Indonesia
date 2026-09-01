"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, materialClaimsList } from "@/lib/mrp/derive";
import { countMaterialClaimsUnresolved, countMaterialPOsAwaitingInvoice, countMrpWithoutPO, countVendorInvoicesAwaitingReview } from "@/lib/shell/badges";
import type { MaterialPoStatus } from "@/lib/mrp/types";

function StatusBar({ selesai, proses, batal }: { selesai: number; proses: number; batal: number }) {
  return (
    <div className="mt-1.5 flex h-3.5 overflow-hidden rounded-[3px]">
      <span style={{ width: `${selesai}%`, background: "#1F8A55" }} />
      {proses > 0 && <span style={{ width: `${proses}%`, background: "#8FB4D4" }} />}
      {batal > 0 && <span style={{ width: `${batal}%`, background: "#C0413A" }} />}
    </div>
  );
}

const DONE_STATUSES: MaterialPoStatus[] = ["DELIVERY_MATERIAL", "PROSES_PRODUKSI"];

export default function ProcurementDashboardPage() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const invoices = useMrpStore((s) => s.invoices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);

  const stats = useMemo(() => {
    const mrpWithoutPo = mrpDetails.filter((d) => d.ppicApproval === "PPIC_APPROVED" && !d.poSent);
    const unresolvedClaims = materialClaimsList(invoices).filter((c) => !materialClaimResolutions[c.key]);
    const awaitingInvoice = materialPOs.filter((po) => po.status !== "CANCELLED" && po.approved && po.invoicedRolls < po.rollCount);
    const invoiceValuePending = awaitingInvoice.reduce((s, po) => s + po.amount, 0);
    const vendorInvoicesPending = vendorInvoices.filter((i) => i.status === "SUBMITTED");
    const vendorInvoiceValuePending = vendorInvoicesPending.reduce((s, i) => s + i.totalTagihan, 0);

    const bySupplier = new Map<string, MaterialPoStatus[]>();
    for (const po of materialPOs) {
      const arr = bySupplier.get(po.supplier) ?? [];
      for (let i = 0; i < Math.max(1, Math.round(po.rollCount)); i++) arr.push(po.status);
      bySupplier.set(po.supplier, arr);
    }
    const supplierRows = Array.from(bySupplier.entries())
      .map(([supplier, statuses]) => {
        const total = statuses.length || 1;
        const selesai = statuses.filter((s) => DONE_STATUSES.includes(s)).length;
        const batal = statuses.filter((s) => s === "CANCELLED").length;
        const proses = total - selesai - batal;
        return {
          supplier,
          roll: statuses.length,
          selesaiPct: Math.round((selesai / total) * 100),
          prosesPct: Math.round((proses / total) * 100),
          batalPct: Math.round((batal / total) * 100),
          note: `Selesai ${selesai} · Proses ${proses}${batal > 0 ? ` · Batal ${batal}` : ""}`,
        };
      })
      .sort((a, b) => b.roll - a.roll)
      .slice(0, 6);

    return { mrpWithoutPo, unresolvedClaims, awaitingInvoice, invoiceValuePending, vendorInvoicesPending, vendorInvoiceValuePending, supplierRows };
  }, [mrpDetails, materialPOs, vendorInvoices, invoices, materialClaimResolutions]);

  return (
    <AppShell
      role="procurement"
      activeHref="/dashboard/procurement"
      breadcrumb={["Dashboard", "Procurement"]}
      title="Perlu tindakan Anda"
      subtitle={`${countMrpWithoutPO(mrpDetails) + countMaterialClaimsUnresolved(invoices, materialClaimResolutions) + countMaterialPOsAwaitingInvoice(materialPOs) + countVendorInvoicesAwaitingReview(vendorInvoices)} item terbuka`}
    >
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="MRP Belum Dibuatkan PO" value={String(stats.mrpWithoutPo.length)} sub="siap dibuatkan PO" accent="orange" />
        <KpiCard label="Klaim Material Terbuka" value={String(stats.unresolvedClaims.length)} sub="selisih berat di luar toleransi" subClassName="text-danger-fg" accent="danger" />
        <KpiCard label="PO Menunggu Invoice" value={String(stats.awaitingInvoice.length)} sub={formatRupiah(stats.invoiceValuePending)} />
        <KpiCard label="Invoice Vendor Menunggu Review" value={String(stats.vendorInvoicesPending.length)} sub={formatRupiah(stats.vendorInvoiceValuePending)} />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">MRP menunggu PO</div>
          {stats.mrpWithoutPo.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Semua MRP sudah dibuatkan PO.</div>}
          {stats.mrpWithoutPo.slice(0, 6).map((d, i, arr) => (
            <div key={d.mrp.id} className={"flex items-center gap-3 px-4 py-3" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")} style={{ borderLeft: "3px solid #C9791A" }}>
              <div className="flex-1">
                <div className="font-sans text-[12.5px] font-semibold text-text-primary">{d.mrp.id}</div>
                <div className="font-sans text-[11.5px] text-text-muted">
                  {d.mrp.kategori} · {d.mrp.warna} · {formatPcs(d.mrp.qty)} pcs
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Status material per supplier</div>
          <div className="flex flex-col gap-3.5 px-4 py-3.5">
            {stats.supplierRows.length === 0 && <div className="text-center font-sans text-xs text-text-muted">Belum ada PO material.</div>}
            {stats.supplierRows.map((s) => (
              <div key={s.supplier}>
                <div className="flex font-sans text-xs font-semibold text-[#31414F]">
                  <span>{s.supplier}</span>
                  <span className="ml-auto font-mono text-[11px] font-normal text-text-muted">{s.roll} roll</span>
                </div>
                <StatusBar selesai={s.selesaiPct} proses={s.prosesPct} batal={s.batalPct} />
                <div className="mt-1 font-mono text-[11px] text-text-muted">{s.note}</div>
              </div>
            ))}
            {stats.supplierRows.length > 0 && (
              <div className="flex gap-4 border-t border-[#EEF1F4] pt-3 font-sans text-[11px] text-text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-sm bg-success" />
                  Selesai
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-sm bg-[#8FB4D4]" />
                  Proses
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-sm bg-danger" />
                  Batal
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center border-b border-border-subtle px-4 py-3">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Klaim material terbuka</span>
        </div>
        <div className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted" style={{ gridTemplateColumns: "130px 1fr 110px 110px" }}>
          <span>No. PO</span>
          <span>Warna / Lengan</span>
          <span>Roll</span>
          <span>Selisih</span>
        </div>
        {stats.unresolvedClaims.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada klaim material terbuka.</div>}
        {stats.unresolvedClaims.slice(0, 6).map((c, i, arr) => (
          <div key={c.key} className={"grid items-center gap-x-2 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")} style={{ gridTemplateColumns: "130px 1fr 110px 110px" }}>
            <span className="font-mono font-medium">{c.invoiceId}</span>
            <span>
              {c.warna} · {c.lengan}
            </span>
            <span className="font-mono">Roll #{c.rollIndex + 1}</span>
            <span className="font-mono font-medium text-danger-fg">
              {c.diffKg >= 0 ? "+" : ""}
              {c.diffKg.toFixed(2)} kg
            </span>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
