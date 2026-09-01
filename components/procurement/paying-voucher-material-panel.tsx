"use client";

import { useState } from "react";
import { ClosePoReasonModal } from "@/components/mrp/close-po-reason-modal";
import { PayingVoucherWizard } from "@/components/mrp/paying-voucher-wizard";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatRupiah, invoiceBadge, materialSupplierNamesForWarna } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { RawMaterialInvoice } from "@/lib/mrp/types";

/** Panel "Invoice Material" — konten diekstrak dari halaman lama Paying Voucher (Invoice)
 *  (yang sekarang jadi satu sub-tab, berdampingan dengan panel monitoring Invoice Maklon). */
export function PayingVoucherMaterialPanel() {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const bookInvoice = useMrpStore((s) => s.bookInvoice);
  const closePoWithReason = useMrpStore((s) => s.closePoWithReason);
  const reassignMaterialToSupplier = useMrpStore((s) => s.reassignMaterialToSupplier);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const supplierList = useMrpStore((s) => s.supplierList);

  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [afterSubmitPoId, setAfterSubmitPoId] = useState<string | null>(null);
  const [closingPoId, setClosingPoId] = useState<string | null>(null);

  const pvHistoryColumns: ColumnDef<RawMaterialInvoice>[] = [
    { key: "noInvoice", label: "No Invoice", default: true, render: (i) => <span className="font-mono font-medium">{i.id}</span> },
    { key: "noPo", label: "No PO", default: true, render: (i) => <span className="font-mono">{i.poId}</span> },
    { key: "supplierVendor", label: "Supplier → Vendor", default: true, render: (i) => `${i.supplier} → ${VENDOR_PRODUKSI[i.destinationVendor]?.name ?? i.destinationVendor}` },
    // default:false — dibatasi 7 kolom total (lihat konvensi "kolom penting saja default" di
    // halaman lain), kode transaksi masih bisa dicek lewat toggle "Kolom" kalau perlu.
    { key: "kodeTransaksi", label: "Kode Transaksi", default: false, render: (i) => <span className="font-mono">{i.kodeTransaksi}</span> },
    { key: "total", label: "Total PV", default: true, align: "right", render: (i) => formatRupiah(i.totalBiaya) },
    { key: "tglPv", label: "Tanggal PV", default: true, render: (i) => formatDate(i.bookedAt) },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill> },
    {
      key: "bukti",
      label: "Bukti PV",
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

  const openPOs = materialPOs.filter((po) => po.status !== "CANCELLED" && po.approved && po.invoicedRolls < po.rollCount);
  const selectedPo = openPOs.find((p) => p.id === selectedPoId) ?? null;
  const afterSubmitPo = afterSubmitPoId ? materialPOs.find((p) => p.id === afterSubmitPoId) : null;
  const closingPo = closingPoId ? materialPOs.find((p) => p.id === closingPoId) : null;
  const remainingAfter = afterSubmitPo ? afterSubmitPo.rollCount - afterSubmitPo.invoicedRolls : 0;

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-3 font-sans text-[13px] font-semibold text-text-primary">PO material belum memiliki invoice</div>
        <div className="grid border-b border-border-subtle bg-[#F7F9FB] px-5 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted" style={{ gridTemplateColumns: "100px 110px 1fr 90px 90px 130px 70px" }}>
          <span>No. MRP</span>
          <span>No. PO</span>
          <span>Supplier / vendor</span>
          <span className="text-right">Roll sisa</span>
          <span className="text-right">Roll total</span>
          <span />
          <span />
        </div>
        {openPOs.length === 0 && <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO material yang perlu diinvoice.</div>}
        {openPOs.map((po) => {
          const remaining = po.rollCount - po.invoicedRolls;
          return (
            <div key={po.id} className="grid items-center border-b border-[#F1F4F7] px-5 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0" style={{ gridTemplateColumns: "100px 110px 1fr 90px 90px 130px 70px" }}>
              <span className="font-mono">{po.mrpId}</span>
              <span className="font-mono font-medium">{po.id}</span>
              <span>
                {po.supplier} → {VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi} · {po.colorBreakdown.map((c) => c.warna).join(", ")}
              </span>
              <span className="text-right font-mono">{remaining}</span>
              <span className="text-right font-mono">{po.rollCount}</span>
              <Button
                onClick={() => {
                  setSelectedPoId(po.id);
                  setAfterSubmitPoId(null);
                }}
                variant="primary"
                size="xs"
                className="ml-auto"
              >
                Buat PV
              </Button>
              <Button onClick={() => setClosingPoId(po.id)} variant="danger" size="xs" className="ml-auto">
                Close
              </Button>
            </div>
          );
        })}

        {selectedPo && (
          <PayingVoucherWizard
            po={selectedPo}
            mrpDetails={mrpDetails}
            onCancel={() => setSelectedPoId(null)}
            onSubmit={async (input) => {
              // WAJIB di-await -- lihat catatan panjang di paying-voucher-wizard.tsx. Kalau
              // bookInvoice gagal (throw), biarkan error itu naik ke try/catch wizard (JANGAN
              // ditangkap di sini) supaya wizard TIDAK ikut-ikutan pindah ke state "sukses" kalau
              // sebenarnya gagal.
              await bookInvoice(selectedPo.id, input);
              setAfterSubmitPoId(selectedPo.id);
              setSelectedPoId(null);
            }}
          />
        )}

        {afterSubmitPo && remainingAfter > 0 && (
          <div className="border-t border-[#F0DFC2] bg-warning-bg px-5 py-4">
            <div className="font-sans text-xs font-semibold text-warning-fg">Sisa {remainingAfter} roll belum tercover invoice ini.</div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  setSelectedPoId(afterSubmitPo.id);
                  setAfterSubmitPoId(null);
                }}
                className="rounded-md bg-action-primary px-3.5 py-[7px] font-sans text-xs font-semibold text-white"
              >
                Buat invoice sisa
              </button>
              <button onClick={() => setAfterSubmitPoId(null)} className="rounded-md border border-[#CBD5DF] px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Nanti saja
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-4 text-center font-sans text-xs text-text-muted">
        Status lengkap tiap PO material (invoice, delivery, receiving, dst) dipindahkan ke halaman{" "}
        <a href="/procurement/material-tracking" className="font-semibold text-action-primary">
          Material Tracking
        </a>
        .
      </div>

      {/* Arsip/histori — dulu begitu PV diajukan, invoice-nya "hilang" dari layar (cuma nongol
         lagi kalau masih ada sisa roll belum tercover), jadi tidak ada bukti/arsip PV yang sudah
         pernah dibuat. Sekarang SEMUA invoice yang pernah dibuat tetap tercatat & terlihat di
         sini, apa pun status lanjutannya. */}
      <DataTable
        title="Riwayat Paying Voucher"
        subtitle={`${invoices.length} PV tercatat — arsip semua PV yang pernah diajukan`}
        columns={pvHistoryColumns}
        rows={invoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(i) => <span className="font-mono">{i.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(invoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "No PO", options: Array.from(new Set(invoices.map((i) => i.poId))), test: (i, v) => i.poId === v },
          { label: "Status", options: Array.from(new Set(invoices.map((i) => invoiceBadge(i.status).label))), test: (i, v) => invoiceBadge(i.status).label === v },
        ]}
        emptyText="Belum ada PV yang pernah diajukan."
      />

      {closingPo && (
        <ClosePoReasonModal
          po={closingPo}
          supplierOptionsForWarna={(warna) => materialSupplierNamesForWarna(hargaKain, supplierList, warna)}
          onNo={() => setClosingPoId(null)}
          onYes={(reason, warna, lengan, closeQty, newSupplier) => {
            if (newSupplier) {
              reassignMaterialToSupplier(closingPo.id, warna, lengan, closeQty, newSupplier, reason);
            } else {
              closePoWithReason(closingPo.id, reason, warna, lengan, closeQty);
            }
            setClosingPoId(null);
            setAfterSubmitPoId(null);
          }}
        />
      )}
    </>
  );
}
