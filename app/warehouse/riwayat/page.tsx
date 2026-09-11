"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, formatRupiah, mrpMetaFor } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { WarehouseReceipt } from "@/lib/mrp/types";

function ReceiptItemsTable({ receipt }: { receipt: WarehouseReceipt }) {
  const totalNilai = receipt.items.reduce((s, it) => s + it.qty * it.hppPerItem, 0);
  return (
    <div className="overflow-x-auto rounded-md border border-[#E4E9EE] bg-white">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="px-3 py-2 text-left">Koli</th>
            <th className="px-3 py-2 text-left">Warna / lengan</th>
            <th className="px-3 py-2 text-left">Size</th>
            <th className="px-3 py-2 text-left">Jenis</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">HPP/item</th>
            <th className="px-3 py-2 text-right">Nilai</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((it, i) => (
            <tr key={i} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
              <td className="px-3 py-1.5 font-mono text-text-muted">{it.deliveryKoliId ?? "—"}</td>
              <td className="px-3 py-1.5">
                {it.warna} · {it.lengan}
              </td>
              <td className="px-3 py-1.5">{it.size}</td>
              <td className="px-3 py-1.5">{it.kind === "FG" ? "FG" : it.kind === "REWORK" ? "Rework" : "Reject"}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(it.qty)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(it.hppPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold text-text-primary">{formatRupiah(it.qty * it.hppPerItem)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#E4E9EE] bg-[#F7F9FB] font-sans text-[11.5px] font-semibold text-text-primary">
            <td className="px-3 py-1.5" colSpan={6}>
              Total nilai penerimaan
            </td>
            <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(totalNilai)}</td>
          </tr>
        </tfoot>
      </table>
      {receipt.note && <div className="border-t border-[#E4E9EE] px-3 py-2 font-sans text-[11px] text-text-muted">Catatan: {receipt.note}</div>}
    </div>
  );
}

export default function WarehouseRiwayatPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const warehouseReceipts = useMrpStore((s) => s.warehouseReceipts);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);

  if (!mounted) return null;

  const rows = [...warehouseReceipts].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  const totalNilaiKeseluruhan = rows.reduce((s, r) => s + r.items.reduce((s2, it) => s2 + it.qty * it.hppPerItem, 0), 0);
  const totalQtyKeseluruhan = rows.reduce((s, r) => s + r.items.reduce((s2, it) => s2 + it.qty, 0), 0);

  const columns: ColumnDef<WarehouseReceipt>[] = [
    { key: "resi", label: "No Resi", default: true, render: (r) => <span className="font-mono">{r.resiGroupId}</span> },
    { key: "koli", label: "Jumlah Koli", default: true, align: "right", render: (r) => formatPcs(r.koliIds.length) },
    { key: "mrp", label: "No MRP", default: true, render: (r) => <span className="font-mono">{mrpMetaFor(r.mrpId, mrpDetails, staticMrps) ? `${r.mrpId} ${mrpMetaFor(r.mrpId, mrpDetails, staticMrps)?.kategori ?? ""}`.trim() : r.mrpId}</span> },
    { key: "vendor", label: "Vendor Produksi", default: true, render: (r) => VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi },
    { key: "invoice", label: "No Invoice Vendor", default: true, render: (r) => r.vendorInvoiceId ?? "—" },
    { key: "receivedAt", label: "Tanggal Terima", default: true, render: (r) => formatDate(r.receivedAt) },
    {
      key: "qty",
      label: "Total Qty",
      default: true,
      align: "right",
      render: (r) => formatPcs(r.items.reduce((s, it) => s + it.qty, 0)),
    },
    {
      key: "nilai",
      label: "Total Nilai",
      default: true,
      align: "right",
      render: (r) => formatRupiah(r.items.reduce((s, it) => s + it.qty * it.hppPerItem, 0)),
    },
  ];

  return (
    <AppShell
      role="warehouse"
      activeHref="/warehouse/riwayat"
      breadcrumb={["Warehouse", "Riwayat Penerimaan"]}
      title="Riwayat Penerimaan"
      subtitle="Arsip read-only penerimaan yang sudah dibongkar — item, qty, dan HPP/item tersnapshot saat diterima"
    >
      <div className="grid grid-cols-3 gap-3.5">
        <KpiCard label="Total penerimaan" value={formatPcs(rows.length)} sub="resi sudah dibongkar" accent="blue" />
        <KpiCard label="Total qty diterima" value={formatPcs(totalQtyKeseluruhan)} sub="pcs" accent="teal" />
        <KpiCard label="Total nilai diterima" value={formatRupiah(totalNilaiKeseluruhan)} accent="purple" />
      </div>

      <DataTable
        title="Riwayat Penerimaan"
        subtitle="Klik baris untuk lihat rincian item"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No Penerimaan"
        firstColumnRender={(r) => <span className="font-mono">{r.id}</span>}
        renderExpanded={(r) => <ReceiptItemsTable receipt={r} />}
        emptyText="Belum ada penerimaan yang dibongkar."
      />
    </AppShell>
  );
}
