"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/ui/status-pill";
import { NumberInput } from "@/components/mrp/number-input";
import { useMrpStore } from "@/lib/mrp/store";
import {
  autoOngkirForInvoice,
  formatPcs,
  formatRupiah,
  hppRowsForInvoice,
  invoiceCategoryLabel,
  invoiceYieldSummary,
  mrpMetaFor,
  productionYieldByWarna,
  productionYieldBySize,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceBadge,
  vendorInvoiceFinalAmount,
  vendorInvoicePaymentStatus,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MrpDetail } from "@/lib/mrp/store";
import type {
  DeliveryKoli,
  Lengan,
  Mrp,
  ProductionBatch,
  ProductionGroupMeta,
  ProductionResult,
  RawMaterialInvoice,
  VendorInvoice,
  VendorInvoiceAdjustmentKind,
} from "@/lib/mrp/types";

/** Panel "Invoice Vendor" — konten dipindah dari halaman standalone /procurement/invoice-vendor
 *  (sekarang jadi tab di Paying Voucher (Invoice), bareng "Invoice Material") supaya sidebar
 *  Procurement tidak punya item terpisah untuk ini lagi. Route lama sudah jadi redirect (lihat
 *  app/procurement/invoice-vendor/page.tsx). Logic & UI TIDAK berubah dari versi standalone. */

function exportInvoiceLampiranExcel(
  inv: VendorInvoice,
  ongkirTotal: number,
  mrpDetails: MrpDetail[],
  staticMrps: Mrp[],
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  rawInvoices: RawMaterialInvoice[],
  deliveryKolis: DeliveryKoli[]
): XLSX.WorkSheet {
  const hppRows = hppRowsForInvoice(inv, ongkirTotal, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis);

  const rows = hppRows.map((d) => ({
    MRP: d.mrpLabel,
    WARNA: d.warna,
    ITEM: d.item,
    "JENIS LENGAN DAN UKURAN": d.jenis,
    "QTY PO": d.qtyPo,
    CUTTING: d.cutting,
    FG: d.fg,
    REJECT: d.reject,
    REWORK: d.rework,
    Status: d.statusLabel,
    yield: `${d.yieldPct.toFixed(1)}%`,
    Maklon: d.maklonRate,
    "Pemotongan/Denda": Math.round(d.pemotonganDenda),
    "Total Biaya Produksi": Math.round(d.biayaProduksiTotal),
    "Jumlah Roll": d.jumlahRoll,
    "Total Berat Bahan (kg)": Number(d.totalBeratBahan.toFixed(2)),
    "Faktor Produksi": Number(d.faktorProduksi.toFixed(3)),
    "Aktual Berat Terpakai (kg)": Number(d.aktualBeratTerpakai.toFixed(4)),
    "Persentase (%)": Number((d.persentase * 100).toFixed(2)),
    "Harga Bahan (Rp)": Math.round(d.hargaBahanTotal),
    "COGS Bahan (Rp)": Math.round(d.cogsBahan),
    "COGS Bahan/Item": Math.round(d.cogsBahanPerItem),
    "Ongkir/Item": Math.round(d.ongkirPerItem),
    "Total Ongkir": Math.round(d.totalOngkirRow),
    "COGS/Item": Math.round(d.hppPerItem),
    HPP: Math.round(d.hppPerItem),
  }));

  return XLSX.utils.json_to_sheet(rows);
}

function downloadInvoiceLampiran(
  invoices: VendorInvoice[],
  mrpDetails: MrpDetail[],
  staticMrps: Mrp[],
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  rawInvoices: RawMaterialInvoice[],
  deliveryKolis: DeliveryKoli[]
) {
  const wb = XLSX.utils.book_new();
  for (const inv of invoices) {
    // Ongkir SELALU dihitung otomatis dari data delivery+ekspedisi terbaru (autoOngkirForInvoice,
    // sama seperti Laporan HPP) — dulu ada modal yang minta user input manual sebelum download,
    // tapi angkanya tidak pernah dipakai di Laporan HPP (yang sudah live-compute sendiri) jadi
    // cuma bikin 2 sumber ongkir yang bisa beda-beda. Sekarang dihapus, download langsung jalan.
    const ws = exportInvoiceLampiranExcel(
      inv,
      autoOngkirForInvoice(inv, deliveryKolis),
      mrpDetails,
      staticMrps,
      productionBatches,
      productionResults,
      productionGroupMeta,
      rawInvoices,
      deliveryKolis
    );
    XLSX.utils.book_append_sheet(wb, ws, inv.id.slice(0, 31));
  }
  const filename = invoices.length === 1 ? `${invoices[0].id}-lampiran.xlsx` : `lampiran-invoice-vendor-${invoices.length}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function InvoiceVendorReviewPanel() {
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const addVendorInvoiceAdjustment = useMrpStore((s) => s.addVendorInvoiceAdjustment);
  const setVendorInvoiceStatus = useMrpStore((s) => s.setVendorInvoiceStatus);

  const [expandedInvoiceId, setExpandedInvoiceId] = useState("");
  const [expandedMrpKey, setExpandedMrpKey] = useState("");
  const [expandedWarnaKey, setExpandedWarnaKey] = useState("");
  const [adjKind, setAdjKind] = useState<VendorInvoiceAdjustmentKind>("DENDA");
  const [adjLabel, setAdjLabel] = useState("");
  const [adjAmount, setAdjAmount] = useState(0);
  const [adjNote, setAdjNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pending = vendorInvoices.filter((i) => i.status === "SUBMITTED");
  const sorted = [...vendorInvoices].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  function resetAdjForm() {
    setAdjLabel("");
    setAdjAmount(0);
    setAdjNote("");
  }

  function submitAdjustment(invoiceId: string) {
    if (!adjLabel.trim()) return;
    // TIDAK_ADA murni catatan audit ("tepat waktu, tanpa sanksi") — amount-nya dipaksa 0 dan
    // tidak disyaratkan diisi user, beda dari DENDA/REWARD yang butuh nominal > 0.
    if (adjKind !== "TIDAK_ADA" && (!adjAmount || adjAmount <= 0)) return;
    addVendorInvoiceAdjustment(invoiceId, { kind: adjKind, label: adjLabel.trim(), amount: adjKind === "TIDAK_ADA" ? 0 : adjAmount, note: adjNote.trim() || undefined });
    resetAdjForm();
  }

  return (
    <>
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        Vendor produksi mengajukan invoice dari menu Invoice &amp; Payment. Tambahkan denda/reward sesuai kontrak bila perlu, lalu Setujui — invoice yang disetujui
        akan muncul di menu Finance &gt; Payment Maklon untuk diproses pembayarannya.
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-2.5 font-sans text-[11.5px] font-medium text-warning-fg">
          {pending.length} invoice vendor menunggu review — klik baris untuk buka detail &amp; Setujui.
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
          <button
            onClick={() => {
              const invoicesToExport = vendorInvoices.filter((i) => selected.has(i.id));
              downloadInvoiceLampiran(invoicesToExport, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis);
              setSelected(new Set());
            }}
            className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-info-fg"
          >
            Download Lampiran Invoice ({selected.size})
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Semua invoice vendor</div>
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div
              className="grid items-center gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "28px 110px 1fr 100px 90px 130px 70px 110px 130px 90px 24px" }}
            >
              <span />
              <span>No Invoice</span>
              <span>Vendor</span>
              <span>MRP</span>
              <span className="text-right">Total qty</span>
              <span className="text-right">Total tagihan</span>
              <span className="text-right">Yield</span>
              <span>Status</span>
              <span>Status Payment</span>
              <span>Tanggal</span>
              <span />
            </div>
            {sorted.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada invoice vendor.</div>}
            {sorted.map((inv) => {
              const invExpanded = expandedInvoiceId === inv.id;
              const totalQtyInv = inv.lines.reduce((s, l) => s + l.qty, 0);
              const payment = vendorInvoicePaymentStatus(inv);
              const finalAmount = vendorInvoiceFinalAmount(inv);
              const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
              const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
              const yieldSummary = invoiceYieldSummary(inv, mrpDetails, productionBatches, productionResults);
              return (
                <div key={inv.id}>
                  <div
                    className={
                      "grid w-full items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB] " +
                      (inv.status === "SUBMITTED" && !invExpanded ? "bg-warning-bg/40" : "")
                    }
                    style={{ gridTemplateColumns: "28px 110px 1fr 100px 90px 130px 70px 110px 130px 90px 24px" }}
                  >
                    <Checkbox checked={selected.has(inv.id)} onChange={() => toggleSelect(inv.id)} title="Pilih untuk download lampiran" />
                    <button
                      onClick={() => setExpandedInvoiceId(invExpanded ? "" : inv.id)}
                      title={inv.status === "SUBMITTED" ? "Klik untuk buka detail & Setujui invoice" : "Klik untuk buka detail"}
                      className="col-span-9 grid items-center gap-x-3 text-left"
                      style={{ gridTemplateColumns: "110px 1fr 100px 90px 130px 70px 110px 130px 90px" }}
                    >
                      <span className="font-mono font-medium">{inv.id}</span>
                      <span>{VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi}</span>
                      <span>{inv.lines.map((l) => l.mrpId).join(", ")}</span>
                      <span className="text-right font-mono">{formatPcs(totalQtyInv)}</span>
                      <span className="text-right">
                        {/* BUG lama: kolom ini selalu nampilin inv.netTagihan mentah, jadi denda/
                            reward yang ditambahkan Procurement (lihat panel "Denda / reward" di
                            bawah) kelihatan seperti tidak berpengaruh sama sekali ke nilai invoice
                            — padahal finalAmount (dipakai "Total tagihan akhir" di detail) sudah
                            benar dihitung, cuma tidak pernah ditampilkan di baris ringkas ini. */}
                        <div className="font-mono">{formatRupiah(finalAmount)}</div>
                        {(denda > 0 || reward > 0) && (
                          <div className="font-mono text-[10px] text-text-muted">
                            net {formatRupiah(inv.netTagihan)}
                            {denda > 0 && ` − denda ${formatRupiah(denda)}`}
                            {reward > 0 && ` + reward ${formatRupiah(reward)}`}
                          </div>
                        )}
                      </span>
                      <span className="text-right font-mono">{yieldSummary.yieldPct.toFixed(1)}%</span>
                      <span>
                        <StatusPill tone={vendorInvoiceBadge(inv.status).tone}>{vendorInvoiceBadge(inv.status).label}</StatusPill>
                      </span>
                      <span>
                        <StatusPill tone={payment.tone}>{payment.label}</StatusPill>
                      </span>
                      <span className="font-mono text-[11px] text-text-muted">{inv.submittedAt}</span>
                    </button>
                    <button
                      onClick={() => setExpandedInvoiceId(invExpanded ? "" : inv.id)}
                      title={invExpanded ? "Tutup detail" : "Buka detail"}
                      className="flex items-center justify-center text-text-muted hover:text-action-primary"
                    >
                      {invExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
              {invExpanded && (
                <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-3">
                  <div className="rounded-md border border-[#E4E9EE] bg-white p-3">
                    <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Denda / reward sesuai kontrak</div>
                    {(inv.adjustments?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        {inv.adjustments.map((a) => (
                          <div key={a.id} className="mt-1 flex items-center justify-between font-sans text-[11.5px] text-[#31414F]">
                            <span>
                              <span className={a.kind === "DENDA" ? "text-danger-fg" : a.kind === "REWARD" ? "text-success-fg" : "text-text-muted"}>
                                {a.kind === "DENDA" ? "Denda" : a.kind === "REWARD" ? "Reward" : "Tidak ada sanksi"}
                              </span>
                              {" — "}
                              {a.label}
                              {a.note && <span className="text-text-muted"> ({a.note})</span>}
                            </span>
                            <span className="font-mono">
                              {a.kind === "TIDAK_ADA" ? "—" : (a.kind === "DENDA" ? "−" : "+") + formatRupiah(a.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between border-t border-[#F1F4F7] pt-2 font-sans text-[11.5px] font-semibold text-[#31414F]">
                      <span>Total tagihan akhir</span>
                      <span className="font-mono">{formatRupiah(finalAmount)}</span>
                    </div>
                    {(denda > 0 || reward > 0) && (
                      <div className="mt-0.5 font-sans text-[10px] text-text-muted">
                        Net tagihan {formatRupiah(inv.netTagihan)} {denda > 0 && `− denda ${formatRupiah(denda)} `}
                        {reward > 0 && `+ reward ${formatRupiah(reward)}`}
                      </div>
                    )}

                    {inv.status === "SUBMITTED" && (
                      <div className="mt-3 grid grid-cols-5 gap-2 border-t border-[#F1F4F7] pt-3">
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Jenis</div>
                          <select
                            value={adjKind}
                            onChange={(e) => setAdjKind(e.target.value as VendorInvoiceAdjustmentKind)}
                            className="input mt-0.5"
                          >
                            <option value="DENDA">Denda</option>
                            <option value="REWARD">Reward</option>
                            <option value="TIDAK_ADA">Tidak ada (tepat waktu)</option>
                          </select>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Label</div>
                          <input value={adjLabel} onChange={(e) => setAdjLabel(e.target.value)} placeholder="Contoh: Keterlambatan 3 hari" className="input mt-0.5" />
                        </div>
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Nominal (Rp)</div>
                          {adjKind === "TIDAK_ADA" ? (
                            <div className="input mt-0.5 flex items-center text-text-muted">— (tidak ada nominal)</div>
                          ) : (
                            <NumberInput value={adjAmount} onChange={setAdjAmount} currency startEmptyIfZero className="input mt-0.5" />
                          )}
                        </div>
                        <div>
                          <div className="font-sans text-[10px] text-text-muted">Catatan (opsional)</div>
                          <input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="—" className="input mt-0.5" />
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={() => submitAdjustment(inv.id)}
                            className="rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[7px] font-sans text-[11px] font-semibold text-text-muted"
                          >
                            + Tambah item
                          </button>
                        </div>
                      </div>
                    )}

                    {inv.status === "SUBMITTED" && (
                      <div className="mt-3 border-t border-[#F1F4F7] pt-3">
                        <button
                          onClick={() => setVendorInvoiceStatus(inv.id, "APPROVED")}
                          className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white"
                        >
                          Setujui invoice
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran — detail per MRP</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                    <span>MRP</span>
                    <span className="text-right">Qty diinvoice</span>
                    <span className="text-right">Nilai</span>
                  </div>
                  {inv.lines.map((line) => {
                    const mrpKey = inv.id + "|" + line.mrpId + "|" + line.warna + "|" + line.lengan + "|" + (line.usia ?? "");
                    const mrpExpanded = expandedMrpKey === mrpKey;
                    const mrp = mrpMetaFor(line.mrpId, mrpDetails, staticMrps);
                    return (
                      <div key={mrpKey}>
                        <button
                          onClick={() => {
                            setExpandedMrpKey(mrpExpanded ? "" : mrpKey);
                            setExpandedWarnaKey("");
                          }}
                          className="grid w-full grid-cols-3 items-center gap-2 border-t border-[#F1F4F7] py-1.5 text-left font-mono text-[11.5px] text-action-primary"
                        >
                          <span>
                            {line.mrpId}{" "}
                            <span className="text-[#94A3B0]">
                              ({invoiceCategoryLabel(mrp, line.usia)} · {line.warna} · {line.lengan})
                            </span>
                          </span>
                          <span className="text-right">{formatPcs(line.qty)}</span>
                          <span className="text-right">{formatRupiah(line.amount)}</span>
                        </button>
                        {mrpExpanded && (
                          <div className="ml-3 border-l border-[#DDE4EB] py-1.5 pl-3">
                            {/* Item 18.5: "Qty PO/cutting" dipecah jadi 2 kolom terpisah -- "Qty PO"
                                (rencana MRP, targetSizesForGroup) vs "Hasil Cutting" (aktual,
                                cuttingSizesForGroup) -- dulu disamakan/di-label seolah 1 angka yang
                                sama, padahal keduanya legitim beda begitu hasil cutting sudah diisi. */}
                            <div className="grid grid-cols-8 gap-2 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                              <span>Warna / lengan</span>
                              <span className="text-right">Qty PO</span>
                              <span className="text-right">Hasil Cutting</span>
                              <span className="text-right">Finish good</span>
                              <span className="text-right">Reject</span>
                              <span className="text-right">Rework</span>
                              <span className="text-right">Yield</span>
                              <span />
                            </div>
                            {productionYieldByWarna(line.mrpId, inv.vendorProduksi, mrpDetails, productionBatches, productionResults).map((r) => {
                              const warnaKey = mrpKey + "|" + r.warna + "|" + r.lengan;
                              const warnaExpanded = expandedWarnaKey === warnaKey;
                              return (
                                <div key={warnaKey}>
                                  <button
                                    onClick={() => setExpandedWarnaKey(warnaExpanded ? "" : warnaKey)}
                                    className="grid w-full grid-cols-8 items-center gap-2 border-t border-[#F1F4F7] py-1.5 text-left font-sans text-[11px] text-[#31414F]"
                                  >
                                    <span>
                                      {r.warna} · {r.lengan}
                                    </span>
                                    <span className="text-right font-mono">{r.target}</span>
                                    <span className="text-right font-mono">{r.cutting}</span>
                                    <span className="text-right font-mono">{r.finishGood}</span>
                                    <span className="text-right font-mono text-danger-fg">{r.reject}</span>
                                    <span className="text-right font-mono text-rework-fg">{r.rework}</span>
                                    <span className="text-right font-mono">{r.yieldPct.toFixed(1)}%</span>
                                    <span className="text-right font-semibold text-action-primary">{warnaExpanded ? "Sembunyikan" : "By size →"}</span>
                                  </button>
                                  {warnaExpanded && (
                                    <div className="ml-3 border-l border-[#DDE4EB] pl-3">
                                      <div className="grid grid-cols-7 gap-2 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                        <span>Size</span>
                                        <span className="text-right">Qty PO</span>
                                        <span className="text-right">Hasil Cutting</span>
                                        <span className="text-right">Finish good</span>
                                        <span className="text-right">Reject</span>
                                        <span className="text-right">Rework</span>
                                        <span className="text-right">Yield</span>
                                      </div>
                                      {productionYieldBySize(line.mrpId, r.warna, r.lengan as Lengan, mrpDetails, productionBatches, productionResults).map((s) => (
                                        <div key={s.size} className="grid grid-cols-7 items-center gap-2 border-t border-[#F1F4F7] py-1 font-mono text-[11px] text-[#31414F]">
                                          <span>{s.size}</span>
                                          <span className="text-right">{s.target}</span>
                                          <span className="text-right">{s.cutting}</span>
                                          <span className="text-right">{s.finishGood}</span>
                                          <span className="text-right text-danger-fg">{s.reject}</span>
                                          <span className="text-right text-rework-fg">{s.rework}</span>
                                          <span className="text-right">{s.yieldPct.toFixed(1)}%</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </div>
      </div>

    </>
  );
}
