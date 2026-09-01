"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, maklonPoBadge, maklonPoDeliveryProgress, maklonPoDisplayStatus, maklonPoInvoiceLockedBy } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

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
        const badge = maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) });
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
        columns={columns}
        rows={rows}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          {
            label: "Vendor",
            options: Array.from(new Set(rows.map((p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi))),
            test: (p, v) => (VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi) === v,
          },
          {
            label: "Status",
            options: Array.from(new Set(rows.map((p) => maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) }).label))),
            test: (p, v) => maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) }).label === v,
          },
        ]}
        emptyText="Belum ada PO vendor produksi yang disetujui Finance."
      />
    </AppShell>
  );
}
