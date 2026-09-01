"use client";

import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, maklonInvoiceBadge } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonInvoice } from "@/lib/mrp/types";

/** Panel monitoring read-only untuk Procurement — supaya bisa pantau status invoice maklon
 *  tanpa buka halaman Finance. Approve & bayar TETAP tugas Finance (di /finance/invoice-maklon,
 *  tidak berubah) — tidak ada kolom Aksi di sini sama sekali, murni sama polanya dengan tabel
 *  "PO Vendor Produksi" di halaman Purchase Order (Procurement lihat status, tidak approve).
 *  Jalur ini sekarang ARSIP — sudah tidak menerima pengajuan baru dari vendor (konsolidasi ke
 *  Invoice Vendor per-pcs), tapi invoice lama yang sudah SUBMITTED sebelum penutupan tetap
 *  perlu diselesaikan Finance seperti biasa, jadi tabel & badge di sini tetap hidup. */
export function InvoiceMaklonMonitorPanel() {
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  const columns: ColumnDef<MaklonInvoice>[] = [
    { key: "poId", label: "No PO Produksi", default: true, render: (i) => <span className="font-mono font-medium">{i.maklonPoId}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (i) => VENDOR_PRODUKSI[i.vendorProduksi]?.name ?? i.vendorProduksi },
    { key: "base", label: "Base fee", default: true, align: "right", render: (i) => formatRupiah(i.baseFee) },
    { key: "penalty", label: "Penalty", default: false, align: "right", render: (i) => (i.penalty ? "−" + formatRupiah(i.penalty) : "—") },
    { key: "bonus", label: "Bonus", default: false, align: "right", render: (i) => (i.bonus ? "+" + formatRupiah(i.bonus) : "—") },
    { key: "retention", label: "Retention", default: false, align: "right", render: (i) => (i.retentionPct ? i.retentionPct + "%" : "—") },
    { key: "net", label: "Net dibayar", default: true, align: "right", render: (i) => formatRupiah(i.netAmount) },
    { key: "entitas", label: "Entitas", default: false, render: (i) => i.entity },
    { key: "note", label: "Catatan vendor", default: false, render: (i) => i.note || "—" },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={maklonInvoiceBadge(i.status).tone}>{maklonInvoiceBadge(i.status).label}</StatusPill> },
  ];

  return (
    <>
      <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
        Jalur ini <b>sudah tidak menerima pengajuan baru</b> — vendor sekarang menagih lewat tab Invoice Vendor (per pcs) di menu Invoice
        Vendor. Tabel di bawah murni arsip + invoice lama yang belum selesai; approve &amp; pembayaran tetap dilakukan Finance di halaman
        Invoice Maklon.
      </div>
      <DataTable
        title="Semua invoice maklon (arsip)"
        columns={columns}
        rows={maklonInvoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(i) => <span className="font-mono">{i.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(maklonInvoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "No PO Produksi", options: Array.from(new Set(maklonInvoices.map((i) => i.maklonPoId))), test: (i, v) => i.maklonPoId === v },
          { label: "Status", options: Array.from(new Set(maklonInvoices.map((i) => i.status))), test: (i, v) => i.status === v },
        ]}
        emptyText="Belum pernah ada invoice maklon yang diajukan sebelum jalur ini ditutup."
      />
    </>
  );
}
