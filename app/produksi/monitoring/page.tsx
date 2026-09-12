"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, maklonPoBadgeWithApproval, maklonPoDeliveryProgress, maklonPoInvoiceLockedBy, productionYieldByWarna } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

/** Item 2026-09-12 (user-requested): breakdown progres produksi PER ITEM (warna/lengan) untuk 1
 *  PO vendor produksi -- pakai productionYieldByWarna yang sama dengan yang sudah dipakai di
 *  invoice-vendor-review-panel.tsx, supaya angka Target/FG/Reject/Rework di sini SELALU konsisten
 *  dengan yang sudah dihitung Procurement saat review invoice (satu sumber kebenaran). */
function MaklonPoItemProgress({ po }: { po: MaklonPO }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);

  const rows = productionYieldByWarna(po.mrpId, po.vendorProduksi, mrpDetails, productionBatches, productionResults);

  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        Progres per item (warna / lengan)
      </div>
      {rows.length === 0 ? (
        <div className="border-t border-[#F1F4F7] px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada data cutting/produksi untuk PO ini.</div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-t border-[#F1F4F7] bg-[#FAFBFC] font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
              <th className="px-3 py-1.5 text-left">Item (Warna / Lengan)</th>
              <th className="px-3 py-1.5 text-right">Target</th>
              <th className="px-3 py-1.5 text-right">Cutting</th>
              <th className="px-3 py-1.5 text-right">Finish Good</th>
              <th className="px-3 py-1.5 text-right">Reject</th>
              <th className="px-3 py-1.5 text-right">Rework</th>
              <th className="px-3 py-1.5 text-right">Yield</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.warna + "|" + r.lengan} className="border-t border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F]">
                <td className="px-3 py-1.5">
                  {r.warna} · {r.lengan}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{formatPcs(r.target)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatPcs(r.cutting)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-medium">{formatPcs(r.finishGood)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-danger-fg">{r.reject > 0 ? formatPcs(r.reject) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono text-warning-fg">{r.rework > 0 ? formatPcs(r.rework) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold">{r.cutting > 0 ? `${r.yieldPct.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ProduksiMonitoringPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  if (!mounted) return null;

  const rows = maklonPOs.filter((p) => p.approved);

  const columns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) + " pcs" },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadgeWithApproval(p, vendorInvoices);
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    {
      key: "progress",
      label: "Progress kirim/tagih",
      default: true,
      render: (p) => {
        // Kalau ditagih lewat jalur Invoice Maklon lama (lump sum), progress qty-per-pcs di bawah
        // tidak relevan — sama seperti catatan di app/procurement/po-approval/page.tsx.
        const lockedBy = maklonPoInvoiceLockedBy(p.mrpId, p.vendorProduksi, maklonInvoices, vendorInvoices);
        if (lockedBy === "maklon") {
          return <span className="font-sans text-[11px] font-medium text-text-muted">Ditagih via Invoice Maklon (lump sum)</span>;
        }
        const prog = maklonPoDeliveryProgress(p, deliveryKolis, vendorInvoices);
        return (
          <div className="flex min-w-[150px] flex-col gap-1.5">
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Kirim</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.deliveredQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-success" style={{ width: `${prog.deliveredPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.deliveredPct}%</span>
            </div>
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Tagih</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.invoicedQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${prog.invoicedPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.invoicedPct}%</span>
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/monitoring"
      breadcrumb={["Dashboard", "Monitoring Produksi"]}
      title="Monitoring Produksi"
      subtitle={`${rows.length} PO vendor produksi — progres kirim & tagih lintas semua vendor`}
    >
      <DataTable
        title="PO vendor produksi"
        subtitle="Klik baris untuk lihat progres produksi per item (warna/lengan) — target, cutting, finish good, reject, rework"
        columns={columns}
        rows={rows}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        renderExpanded={(p) => <MaklonPoItemProgress po={p} />}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          {
            label: "Vendor",
            options: Array.from(new Set(rows.map((p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi))),
            test: (p, v) => (VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi) === v,
          },
          {
            label: "Status",
            options: Array.from(new Set(rows.map((p) => maklonPoBadgeWithApproval(p, vendorInvoices).label))),
            test: (p, v) => maklonPoBadgeWithApproval(p, vendorInvoices).label === v,
          },
        ]}
        emptyText="Belum ada PO vendor produksi yang disetujui Finance."
      />
    </AppShell>
  );
}
