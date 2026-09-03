"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, invoiceBadge } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { RawMaterialInvoice } from "@/lib/mrp/types";

/** Panel "Payment" (material) — konten diekstrak dari halaman lama /finance/payment,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/payment. */
export function PaymentPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const setInvoicesPaid = useMrpStore((s) => s.setInvoicesPaid);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!mounted) return null;

  const selectedList = invoices.filter((i) => selected.has(i.id));
  const selectableToPay = selectedList.filter((i) => i.status === "INVOICED");
  const selectableToUnpay = selectedList.filter((i) => i.status === "PAID");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 6 kolom default (+ checkbox di firstColumn) — No Invoice Supplier & Entitas tetap ada, cuma
  // dipindah ke toggle "Kolom" (lebih ke arah detail rekonsiliasi/akuntansi daripada info inti
  // buat memutuskan bayar/tidak). Urutan: No MRP, No PO, Kode Transaksi, lalu sisanya.
  const columns: ColumnDef<RawMaterialInvoice>[] = [
    { key: "noMrp", label: "No MRP", default: true, render: (i) => <span className="font-mono">{i.mrpId}</span> },
    { key: "noPo", label: "No PO", default: true, render: (i) => <span className="font-mono font-medium">{i.poId}</span> },
    { key: "kodeTransaksi", label: "Kode Transaksi", default: true, render: (i) => <span className="font-mono font-medium">{i.kodeTransaksi}</span> },
    { key: "supplier", label: "Supplier / Vendor", default: true, render: (i) => `${i.supplier} → ${VENDOR_PRODUKSI[i.destinationVendor]?.name ?? i.destinationVendor}` },
    { key: "noInvVendor", label: "No Invoice Supplier", default: false, render: (i) => i.noInvoiceVendor || "—" },
    // default:false — dipindah ke toggle "Kolom" supaya "Lampiran Invoice" bisa masuk default
    // tanpa melebihi batas 7 kolom; nilai & status tetap jadi info inti buat keputusan bayar.
    { key: "roll", label: "Roll", default: false, align: "right", render: (i) => i.qtyReady },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (i) => formatRupiah(i.totalBiaya) },
    { key: "entitas", label: "Entitas", default: false, render: (i) => i.entity },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill> },
    {
      key: "bukti",
      label: "Lampiran Invoice",
      default: true,
      render: (i) =>
        i.buktiPvDataUrl ? (
          <button onClick={() => window.open(i.buktiPvDataUrl, "_blank")} className="font-sans text-[11px] font-semibold text-action-primary underline">
            Lihat bukti
          </button>
        ) : (
          <span className="font-sans text-[11px] text-text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      {invoices.length > 0 && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Centang invoice berstatus INVOICED lalu klik Bayar untuk mengubah ke PAID. Pembayaran juga dapat dibatalkan (kembali ke INVOICED) jika keliru.
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
          {selectableToPay.length > 0 && (
            <button
              onClick={() => {
                setInvoicesPaid(selectableToPay.map((i) => i.id), true);
                setSelected(new Set());
              }}
              className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-success-fg"
            >
              Bayar ({selectableToPay.length})
            </button>
          )}
          {selectableToUnpay.length > 0 && (
            <button
              onClick={() => {
                setInvoicesPaid(selectableToUnpay.map((i) => i.id), false);
                setSelected(new Set());
              }}
              className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-danger-fg"
            >
              Batalkan Bayar ({selectableToUnpay.length})
            </button>
          )}
        </div>
      )}

      <DataTable
        title="Semua invoice material"
        columns={columns}
        rows={invoices}
        keyOf={(i) => i.id}
        firstColumnLabel=""
        firstColumnRender={(i) => (
          <Checkbox checked={selected.has(i.id)} onChange={() => toggle(i.id)} disabled={i.status !== "INVOICED" && i.status !== "PAID"} />
        )}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(invoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "No PO", options: Array.from(new Set(invoices.map((i) => i.poId))), test: (i, v) => i.poId === v },
          { label: "Entitas", options: Array.from(new Set(invoices.map((i) => i.entity))), test: (i, v) => i.entity === v },
          { label: "Status", options: Array.from(new Set(invoices.map((i) => i.status))), test: (i, v) => i.status === v },
        ]}
        emptyText="Belum ada invoice. Input di halaman Paying Voucher (Invoice) terlebih dahulu."
      />
    </>
  );
}
