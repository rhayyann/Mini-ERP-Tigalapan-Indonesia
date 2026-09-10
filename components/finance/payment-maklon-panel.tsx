"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { KoliEkspedisiCard } from "@/components/mrp/koli-ekspedisi-card";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatDate,
  formatPcs,
  formatRupiah,
  invoiceKoliBreakdown,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceBadge,
  vendorInvoiceFinalAmount,
  vendorInvoicePaymentStatus,
  vendorInvoiceTotalPaid,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MrpDetail } from "@/lib/mrp/store";
import type { DeliveryKoli, Mrp, ProductionBatch, ProductionGroupMeta, ProductionResult, RawMaterialInvoice, VendorInvoice } from "@/lib/mrp/types";

/** Detail per-warna/lengan dari satu invoice — dropdown expand baris (pola sama dengan tabel
 *  MRP di PPIC), diminta supaya Finance bisa cek rincian tiap kode transaksi tanpa buka halaman
 *  lain. */
function InvoiceLinesDetail({
  inv,
  vendorInvoices,
  mrpDetails,
  staticMrps,
  productionBatches,
  productionResults,
  productionGroupMeta,
  rawInvoices,
  deliveryKolis,
}: {
  inv: VendorInvoice;
  vendorInvoices: VendorInvoice[];
  mrpDetails: MrpDetail[];
  staticMrps: Mrp[];
  productionBatches: ProductionBatch[];
  productionResults: ProductionResult[];
  productionGroupMeta: ProductionGroupMeta[];
  rawInvoices: RawMaterialInvoice[];
  deliveryKolis: DeliveryKoli[];
}) {
  // Item 2026-09-10 (feedback: "tampilkan informasi yang lebih detail, meliputi Item, Size,
  // Kategori Lengan, Qty, serta nominal ... Tambahkan informasi Nama Vendor dan Tanggal
  // Pengiriman dari ekspedisi ... lampiran ekspedisi ... sebelum melakukan payment") -- reuse
  // `invoiceKoliBreakdown` (SAMA fungsi yang dipakai Procurement "Invoice Vendor", lihat
  // catatan panjang di lib/mrp/derive.ts) supaya breakdown per size + info koli di sini SELALU
  // konsisten dengan yang sudah dicek Procurement, bukan sumber kebenaran kedua yang berbeda.
  const breakdown = invoiceKoliBreakdown(inv, vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis);
  const vendorName = VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi;
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full border-collapse overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
        <thead>
          <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="px-3 py-2 text-left">MRP</th>
            <th className="px-3 py-2 text-left">Warna</th>
            <th className="px-3 py-2 text-left">Lengan</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Rate/pc</th>
            <th className="px-3 py-2 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, idx) => (
            <tr key={idx} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
              <td className="px-3 py-1.5 font-mono">{l.mrpId}</td>
              <td className="px-3 py-1.5">
                {l.warna}
                {l.usia ? ` (${l.usia})` : ""}
              </td>
              <td className="px-3 py-1.5">{l.lengan}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(l.qty)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(l.ratePerPc)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(l.amount)}</td>
            </tr>
          ))}
          <tr className="bg-[#F7F9FB] font-sans text-[11.5px] font-semibold text-[#31414F]">
            <td className="px-3 py-1.5" colSpan={3}>
              Total semua warna
            </td>
            <td className="px-3 py-1.5 text-right font-mono">{formatPcs(inv.lines.reduce((s, l) => s + l.qty, 0))}</td>
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(inv.lines.reduce((s, l) => s + l.amount, 0))}</td>
          </tr>
        </tbody>
      </table>

      <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
        <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Rincian per size &amp; pengiriman</div>
        {breakdown.groups.length === 0 && breakdown.legacyRows.length === 0 && (
          <div className="border-t border-[#F1F4F7] px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada data pengiriman untuk invoice ini.</div>
        )}
        <div className="flex flex-col gap-2 border-t border-[#F1F4F7] p-3">
          {breakdown.groups.map((g) => (
            <div key={g.koliId} className="flex flex-col gap-1.5">
              <KoliEkspedisiCard
                koliId={g.koliId}
                noKoli={g.noKoli}
                ekspedisi={g.ekspedisi}
                deliveredAt={g.deliveredAt}
                ekspedisiNote={g.ekspedisiNote}
                ekspedisiNoteAt={g.ekspedisiNoteAt}
                vendorName={vendorName}
              />
              <table className="w-full border-collapse overflow-hidden rounded border border-[#EEF1F4]">
                <thead>
                  <tr className="bg-[#FAFBFC] font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                    <th className="px-2.5 py-1 text-left">Item</th>
                    <th className="px-2.5 py-1 text-left">Size</th>
                    <th className="px-2.5 py-1 text-left">Kategori Lengan</th>
                    <th className="px-2.5 py-1 text-right">Qty</th>
                    <th className="px-2.5 py-1 text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, idx) => (
                    <tr key={idx} className="border-t border-[#F1F4F7] font-sans text-[11px] text-[#31414F]">
                      <td className="px-2.5 py-1">{r.warna}</td>
                      <td className="px-2.5 py-1 font-mono">{r.size}</td>
                      <td className="px-2.5 py-1">{r.lengan}</td>
                      <td className="px-2.5 py-1 text-right font-mono">{formatPcs(r.qty)}</td>
                      <td className="px-2.5 py-1 text-right font-mono">{formatRupiah(r.nominal)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#F1F4F7] bg-[#FAFBFC] font-sans text-[11px] font-semibold text-[#31414F]">
                    <td className="px-2.5 py-1" colSpan={3}>
                      Subtotal koli ini
                    </td>
                    <td className="px-2.5 py-1 text-right font-mono">{formatPcs(g.totalQty)}</td>
                    <td className="px-2.5 py-1 text-right font-mono">{formatRupiah(g.totalNominal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {breakdown.legacyRows.length > 0 && (
            <div className="font-sans text-[10.5px] text-text-muted">
              {formatPcs(breakdown.legacyRows.reduce((s, r) => s + r.qty, 0))} pcs dari data lama (belum tertaut koli, sebelum migrasi pelacakan pengiriman) — lihat tabel ringkas di atas.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Panel "Payment Maklon" — konten diekstrak dari halaman lama /finance/payment-maklon,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/payment.
 *  Retensi sudah dihapus dari alur (keputusan bisnis terbaru) — pembayaran sekarang cuma
 *  1 tahap: lunas penuh sekaligus, lewat payVendorInvoice. */
export function PaymentMaklonPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const setVendorInvoiceDueDate = useMrpStore((s) => s.setVendorInvoiceDueDate);
  const payVendorInvoice = useMrpStore((s) => s.payVendorInvoice);
  // Item 2026-09-10 (feedback: breakdown per size + info pengiriman/ekspedisi di detail invoice)
  // -- dibutuhkan `invoiceKoliBreakdown` (lihat InvoiceLinesDetail di atas).
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  if (!mounted) return null;

  const readyRows = [...vendorInvoices].filter((i) => i.status === "APPROVED").sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  const paidRows = [...vendorInvoices].filter((i) => i.status === "PAID").sort((a, b) => (a.paidAt ?? "" < (b.paidAt ?? "") ? 1 : -1));

  function toggle(id: string) {
    setActionResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedList = readyRows.filter((i) => selected.has(i.id));

  async function payAll() {
    // CATATAN: dulu payVendorInvoice dipanggil tanpa `await` di dalam loop -- notifikasi "sukses"
    // & pengosongan seleksi langsung tampil sebelum pembayarannya benar-benar tersimpan, jadi
    // baris masih sempat tampak "Belum dibayar" sampai halaman di-reload manual (pola bug yang
    // sama dengan paying-voucher-wizard.tsx / production-cutting-tab.tsx). Sekarang di-await satu
    // per satu supaya notifikasi baru muncul setelah semuanya benar-benar lunas.
    if (paying) return;
    setPaying(true);
    try {
      for (const inv of selectedList) await payVendorInvoice(inv.id);
      setActionResult(`${selectedList.length} invoice dibayar lunas.`);
      setSelected(new Set());
    } finally {
      setPaying(false);
    }
  }

  const readyColumns: ColumnDef<VendorInvoice>[] = [
    { key: "vendor", label: "Vendor", default: true, render: (inv) => VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi },
    {
      key: "total",
      label: "Total tagihan",
      default: true,
      align: "right",
      render: (inv) => {
        const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
        const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
        const finalAmount = vendorInvoiceFinalAmount(inv);
        return (
          <>
            <div className="font-mono font-semibold">{formatRupiah(finalAmount)}</div>
            {(denda > 0 || reward > 0) && (
              <div className="font-mono text-[10px] text-text-muted">
                net {formatRupiah(inv.netTagihan)}
                {denda > 0 && ` − denda ${formatRupiah(denda)}`}
                {reward > 0 && ` + reward ${formatRupiah(reward)}`}
              </div>
            )}
          </>
        );
      },
    },
    {
      key: "dueDate",
      label: "Tanggal Pembayaran",
      default: true,
      render: (inv) => (
        <span onClick={(e) => e.stopPropagation()}>
          <input
            type="date"
            value={inv.dueDate ?? ""}
            onChange={(e) => setVendorInvoiceDueDate(inv.id, e.target.value)}
            className="rounded-md border border-[#DDE4EB] px-2 py-1 font-mono text-[11px]"
          />
        </span>
      ),
    },
    { key: "status", label: "Status", default: true, render: (inv) => <StatusPill tone={vendorInvoiceBadge(inv.status).tone}>{vendorInvoiceBadge(inv.status).label}</StatusPill> },
    {
      key: "payment",
      label: "Status Payment",
      default: true,
      render: (inv) => {
        const payment = vendorInvoicePaymentStatus(inv);
        return <StatusPill tone={payment.tone}>{payment.label}</StatusPill>;
      },
    },
  ];

  const paidColumns: ColumnDef<VendorInvoice>[] = [
    { key: "vendor", label: "Vendor", default: true, render: (inv) => VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi },
    { key: "mrp", label: "MRP", default: true, render: (inv) => Array.from(new Set(inv.lines.map((l) => l.mrpId))).join(", ") },
    { key: "totalQty", label: "Total qty", default: true, align: "right", render: (inv) => formatPcs(inv.lines.reduce((s, l) => s + l.qty, 0)) },
    { key: "totalPaid", label: "Total dibayar", default: true, align: "right", render: (inv) => formatRupiah(vendorInvoiceTotalPaid(inv)) },
    { key: "tglLunas", label: "Tanggal Lunas", default: true, render: (inv) => formatDate(inv.paidAt) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (inv) => {
        const payment = vendorInvoicePaymentStatus(inv);
        return <StatusPill tone={payment.tone}>{payment.label}</StatusPill>;
      },
    },
  ];

  return (
    <>
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        Invoice vendor yang sudah disetujui Procurement (menu Invoice Vendor) muncul di sini untuk diproses pembayarannya. Sudah tidak ada retensi —
        pembayaran langsung lunas penuh sekaligus. Klik baris untuk lihat rincian per warna/lengan dari kode transaksi tersebut.
      </div>

      {actionResult && (
        <div className="flex items-center gap-2 rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-[10px] font-sans text-xs font-medium text-warning-fg">
          {actionResult}
          <button onClick={() => setActionResult(null)} className="ml-auto font-sans text-[11px] font-semibold underline">
            Tutup
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
          <button
            onClick={payAll}
            disabled={paying}
            className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-success-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/* Item revisi 2026-09-05: tombol tidak lagi menampilkan status "Memproses..." --
               `disabled={paying}` di atas tetap mencegah dobel klik, cuma tidak lagi terlihat
               user; hasilnya tampil begitu backgroundRefresh selesai (lihat store.ts). */}
            Bayar Penuh
          </button>
        </div>
      )}

      <DataTable
        title="Invoice vendor siap dibayar"
        columns={readyColumns}
        rows={readyRows}
        keyOf={(inv) => inv.id}
        firstColumnLabel="No Invoice"
        firstColumnRender={(inv) => (
          <span className="flex items-center gap-2.5">
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} />
            </span>
            <span className="font-mono font-medium">{inv.id}</span>
          </span>
        )}
        renderExpanded={(inv) => (
          <InvoiceLinesDetail
            inv={inv}
            vendorInvoices={vendorInvoices}
            mrpDetails={mrpDetails}
            staticMrps={staticMrps}
            productionBatches={productionBatches}
            productionResults={productionResults}
            productionGroupMeta={productionGroupMeta}
            rawInvoices={rawInvoices}
            deliveryKolis={deliveryKolis}
          />
        )}
        emptyText="Belum ada invoice vendor yang disetujui Procurement."
      />

      <DataTable
        title="Invoice vendor telah dibayar"
        columns={paidColumns}
        rows={paidRows}
        keyOf={(inv) => inv.id}
        firstColumnLabel="No Invoice"
        firstColumnRender={(inv) => <span className="font-mono font-medium">{inv.id}</span>}
        renderExpanded={(inv) => (
          <InvoiceLinesDetail
            inv={inv}
            vendorInvoices={vendorInvoices}
            mrpDetails={mrpDetails}
            staticMrps={staticMrps}
            productionBatches={productionBatches}
            productionResults={productionResults}
            productionGroupMeta={productionGroupMeta}
            rawInvoices={rawInvoices}
            deliveryKolis={deliveryKolis}
          />
        )}
        emptyText="Belum ada invoice vendor yang telah dibayar."
      />
    </>
  );
}
