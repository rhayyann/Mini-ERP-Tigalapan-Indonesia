"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { NumberInput } from "@/components/mrp/number-input";
import { KoliEkspedisiCard } from "@/components/mrp/koli-ekspedisi-card";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatPcs,
  formatRupiah,
  invoiceCategoryLabel,
  invoiceKoliBreakdown,
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
import type { Lengan, VendorInvoiceAdjustmentKind } from "@/lib/mrp/types";

/** Panel "Invoice Vendor" — konten dipindah dari halaman standalone /procurement/invoice-vendor
 *  (sekarang jadi tab di Paying Voucher (Invoice), bareng "Invoice Material") supaya sidebar
 *  Procurement tidak punya item terpisah untuk ini lagi. Route lama sudah jadi redirect (lihat
 *  app/procurement/invoice-vendor/page.tsx). Logic & UI TIDAK berubah dari versi standalone.
 *
 *  Revisi 2026-09-12 (user-reported, tes user): fitur "Download Lampiran Invoice" (checkbox pilih
 *  baris + export Excel) DIHAPUS TOTAL -- exportInvoiceLampiranExcel/downloadInvoiceLampiran & state
 *  `selected` yang dulu ada di sini sekarang tidak dipakai lagi, sengaja tidak disisakan sebagai
 *  dead code. */

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

  const pending = vendorInvoices.filter((i) => i.status === "SUBMITTED");
  const sorted = [...vendorInvoices].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  function resetAdjForm() {
    setAdjLabel("");
    setAdjAmount(0);
  }

  const [submittingAdj, setSubmittingAdj] = useState(false);

  // BUG FIX 2026-09-12 (user-reported: pilih Denda/Reward tapi nilai invoice tidak berubah) --
  // sebelumnya ini memanggil addVendorInvoiceAdjustment TANPA await lalu langsung reset form,
  // jadi kalaupun penyimpanannya gagal di server (lihat fix di addVendorInvoiceAdjustmentAction),
  // errornya tidak pernah terlihat -- form sudah kadung ke-reset seolah berhasil. Sekarang
  // ditunggu, form baru direset kalau benar-benar sukses, dan kegagalan ditampilkan jelas.
  async function submitAdjustment(invoiceId: string) {
    if (!adjLabel.trim()) return;
    // TIDAK_ADA murni catatan audit ("tepat waktu, tanpa sanksi") — amount-nya dipaksa 0 dan
    // tidak disyaratkan diisi user, beda dari DENDA/REWARD yang butuh nominal > 0.
    if (adjKind !== "TIDAK_ADA" && (!adjAmount || adjAmount <= 0)) return;
    setSubmittingAdj(true);
    try {
      await addVendorInvoiceAdjustment(invoiceId, { kind: adjKind, label: adjLabel.trim(), amount: adjKind === "TIDAK_ADA" ? 0 : adjAmount });
      resetAdjForm();
    } catch (err) {
      window.alert("Gagal menyimpan denda/reward -- coba lagi. " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmittingAdj(false);
    }
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

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Semua invoice vendor</div>
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div
              className="grid items-center gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "110px 1fr 100px 90px 130px 70px 110px 130px 90px 24px" }}
            >
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
              // Item 2026-09-10 (feedback: info lampiran ekspedisi sebelum "Setujui invoice") --
              // cuma dihitung begitu baris ini di-expand (bukan tiap render semua invoice) supaya
              // tidak ikut menjalankan hppRowsForInvoicePerRoll (lumayan berat, alokasi FIFO) utk
              // baris yang collapsed.
              const koliBreakdown = invExpanded
                ? invoiceKoliBreakdown(inv, vendorInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis)
                : undefined;
              return (
                <div key={inv.id}>
                  {/* Item 2026-09-12 (user-reported, tes user: "banyak yang miss sama simbol ini"
                     -- chevron kecil di ujung kanan dulu satu-satunya petunjuk baris ini bisa
                     diklik): SELURUH baris sekarang 1 elemen <button> yang bisa diklik di mana
                     saja (dulu ada 2 <button> terpisah -- 1 badan baris + 1 chevron -- plus
                     checkbox yang bikin area klik terasa terpecah). Checkbox "pilih untuk download
                     lampiran" juga dihapus (fitur download lampiran dihapus total). */}
                  <button
                    onClick={() => setExpandedInvoiceId(invExpanded ? "" : inv.id)}
                    title={inv.status === "SUBMITTED" ? "Klik untuk buka detail & Setujui invoice" : "Klik untuk buka detail"}
                    className={
                      "grid w-full items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB] " +
                      (inv.status === "SUBMITTED" && !invExpanded ? "bg-warning-bg/40" : "")
                    }
                    style={{ gridTemplateColumns: "110px 1fr 100px 90px 130px 70px 110px 130px 90px 24px" }}
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
                    <span className="flex items-center justify-center text-text-muted">{invExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  </button>
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
                      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-[#F1F4F7] pt-3">
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
                        <div className="flex items-end">
                          <button
                            onClick={() => submitAdjustment(inv.id)}
                            disabled={submittingAdj}
                            className="rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[7px] font-sans text-[11px] font-semibold text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {submittingAdj ? "Menyimpan…" : "+ Tambah item"}
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

                  {/* Item 2026-09-10 (feedback: "Tambahkan informasi mengenai lampiran ekspedisi
                     dari vendor produksi sebelum mengajukan invoice maklon ke finance") -- 1
                     kartu per koli yang mengirim barang invoice ini (lihat KoliEkspedisiCard),
                     ditaruh SEBELUM "Setujui invoice" sudah kelihatan di atas supaya Procurement
                     sempat cek lampiran ekspedisinya dulu sebelum approve. */}
                  {koliBreakdown && (
                    <div className="mt-3 rounded-md border border-[#E4E9EE] bg-white p-3">
                      <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran ekspedisi</div>
                      {koliBreakdown.groups.length === 0 && koliBreakdown.legacyRows.length === 0 && (
                        <div className="mt-1.5 font-sans text-[11.5px] text-text-muted">Belum ada data pengiriman untuk invoice ini.</div>
                      )}
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {koliBreakdown.groups.map((g) => (
                          <KoliEkspedisiCard
                            key={g.koliId}
                            koliId={g.koliId}
                            noKoli={g.noKoli}
                            ekspedisi={g.ekspedisi}
                            deliveredAt={g.deliveredAt}
                            ekspedisiNote={g.ekspedisiNote}
                            ekspedisiNoteAt={g.ekspedisiNoteAt}
                            noResi={g.noResi}
                          />
                        ))}
                      </div>
                      {koliBreakdown.legacyRows.length > 0 && (
                        <div className="mt-1.5 font-sans text-[10.5px] text-text-muted">
                          {formatPcs(koliBreakdown.legacyRows.reduce((s, r) => s + r.qty, 0))} pcs dari data lama (belum tertaut koli, sebelum migrasi pelacakan pengiriman).
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran — detail per MRP</div>
                  <div className="mt-2 grid grid-cols-[1fr_100px_120px_20px] gap-2 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                    <span>MRP</span>
                    <span className="text-right">Qty diinvoice</span>
                    <span className="text-right">Nilai</span>
                    <span />
                  </div>
                  {inv.lines.map((line) => {
                    const mrpKey = inv.id + "|" + line.mrpId + "|" + line.warna + "|" + line.lengan + "|" + (line.usia ?? "");
                    const mrpExpanded = expandedMrpKey === mrpKey;
                    const mrp = mrpMetaFor(line.mrpId, mrpDetails, staticMrps);
                    return (
                      <div key={mrpKey}>
                        {/* Item 2026-09-12 (user-reported, tes user: "user tidak tau kalau ternyata
                           itu bisa diclick") -- dulu cuma teks biru tanpa ikon apa pun sebagai
                           petunjuk, sekarang ditambah chevron (pola sama baris invoice di atas) +
                           hover bg supaya jelas ini bisa diklik untuk buka breakdown per size. */}
                        <button
                          onClick={() => {
                            setExpandedMrpKey(mrpExpanded ? "" : mrpKey);
                            setExpandedWarnaKey("");
                          }}
                          title={mrpExpanded ? "Tutup breakdown per size" : "Klik untuk lihat breakdown per size"}
                          className="grid w-full grid-cols-[1fr_100px_120px_20px] items-center gap-2 rounded-md border-t border-[#F1F4F7] py-1.5 text-left font-mono text-[11.5px] text-action-primary hover:bg-[#F2F5F8]"
                        >
                          <span>
                            {line.mrpId}{" "}
                            <span className="text-[#94A3B0]">
                              ({invoiceCategoryLabel(mrp, line.usia)} · {line.warna} · {line.lengan})
                            </span>
                          </span>
                          <span className="text-right">{formatPcs(line.qty)}</span>
                          <span className="text-right">{formatRupiah(line.amount)}</span>
                          <span className="flex items-center justify-center text-[#94A3B0]">{mrpExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
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
                            {/* BUG FIX (2026-09-10, owner-reported): productionYieldByWarna cuma difilter
                                mrpId+vendorProduksi -- mengembalikan SEMUA warna/lengan yang punya batch
                                produksi di MRP ini, bukan cuma warna/lengan baris invoice ini (`line`). Tanpa
                                filter ini, warna LAIN yang kebetulan juga sedang cutting di MRP yang sama (mis.
                                belum FG-confirmed sama sekali, belum pernah dikirim/diinvoice) ikut "bocor"
                                muncul di breakdown baris invoice yang sebenarnya cuma untuk 1 warna/lengan. */}
                            {productionYieldByWarna(line.mrpId, inv.vendorProduksi, mrpDetails, productionBatches, productionResults)
                              .filter((r) => r.warna === line.warna && r.lengan === line.lengan)
                              .map((r) => {
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
