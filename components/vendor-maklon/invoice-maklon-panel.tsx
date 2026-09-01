"use client";

import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, maklonInvoiceBadge } from "@/lib/mrp/derive";
import type { MaklonInvoice } from "@/lib/mrp/types";

/** Panel "Invoice Maklon" — SEKARANG ARSIP SAJA. Jalur invoice PER-PO (base fee dari nilai PO +
 *  penalty/bonus manual + retensi yang vendor self-report sendiri tanpa direview Procurement)
 *  sudah ditutup untuk pengajuan baru per konsolidasi ke jalur "Invoice Vendor" (per-pcs, ada
 *  review Procurement + bisa dicicil pembayarannya — lihat invoice-vendor-panel.tsx). Riwayat
 *  invoice maklon yang sudah pernah diajukan sebelum penutupan ini tetap tampil di bawah dan
 *  tetap bisa di-approve/dibayar Finance seperti biasa. */
export function InvoiceMaklonPanel({ vendorId }: { vendorId: string }) {
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const myInvoices = maklonInvoices.filter((i) => i.vendorProduksi === vendorId);

  const invoiceColumns: ColumnDef<MaklonInvoice>[] = [
    { key: "poId", label: "No PO Produksi", default: true, render: (i) => <span className="font-mono font-medium">{i.maklonPoId}</span> },
    { key: "base", label: "Base fee", default: true, align: "right", render: (i) => formatRupiah(i.baseFee) },
    { key: "penalty", label: "Penalty", default: false, align: "right", render: (i) => (i.penalty ? "−" + formatRupiah(i.penalty) : "—") },
    { key: "bonus", label: "Bonus", default: false, align: "right", render: (i) => (i.bonus ? "+" + formatRupiah(i.bonus) : "—") },
    { key: "retention", label: "Retention", default: false, align: "right", render: (i) => (i.retentionPct ? i.retentionPct + "%" : "—") },
    { key: "net", label: "Net dibayar", default: true, align: "right", render: (i) => formatRupiah(i.netAmount) },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={maklonInvoiceBadge(i.status).tone}>{maklonInvoiceBadge(i.status).label}</StatusPill> },
  ];

  return (
    <>
      <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-3.5 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
        Jalur Invoice Maklon (per-PO) <b>sudah tidak menerima pengajuan baru</b> — semua penagihan hasil produksi sekarang lewat tab{" "}
        <b>Invoice Vendor (per pcs)</b>. Daftar di bawah ini murni riwayat invoice maklon yang sudah pernah diajukan sebelumnya.
      </div>

      <DataTable
        title="Invoice maklon saya (arsip)"
        columns={invoiceColumns}
        rows={myInvoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No. Invoice"
        firstColumnRender={(i) => <span className="font-mono font-medium">{i.id}</span>}
        filterDefs={[{ label: "Status", options: Array.from(new Set(myInvoices.map((i) => i.status))), test: (i, v) => i.status === v }]}
        emptyText="Belum pernah ada invoice maklon yang diajukan."
      />
    </>
  );
}
