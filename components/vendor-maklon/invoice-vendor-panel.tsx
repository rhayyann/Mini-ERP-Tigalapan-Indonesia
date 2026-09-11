"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatDate,
  formatPcs,
  formatRupiah,
  invoiceProductionStatus,
  invoiceYieldSummary,
  productionYieldByWarna,
  productionYieldBySize,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceBadge,
  vendorInvoiceFinalAmount,
  vendorInvoicePaymentStatus,
} from "@/lib/mrp/derive";
import type { Lengan } from "@/lib/mrp/types";

/** Panel "Invoice Vendor" — konten diekstrak dari halaman lama Invoice & Payment (sekarang
 *  jadi satu sub-tab di halaman yang sama, berdampingan dengan panel "Invoice Maklon"). Alur
 *  invoice PER-PCS delivered × rate (dibatasi kapasitas vendor), direview Procurement dulu
 *  sebelum dibayar Finance — beda dari "Invoice Maklon" yang per-PO base fee.
 *
 *  Item 2026-09-11 (feedback: "ketika sudah final pengiriman nanti akan ada button submit
 *  invoice, jadi tidak ada lagi action apa2 di halaman Invoice & Payment", migration 0026):
 *  section "Create Invoice" (checkbox/qty/rate manual) DIHAPUS TOTAL -- invoice sekarang
 *  diajukan LANGSUNG dari halaman Pengiriman (tombol "Submit Invoice" per grup resi yang sudah
 *  delivered penuh, lihat app/vendor-maklon/pengiriman/page.tsx & submitResiGroupInvoiceAction).
 *  Panel ini jadi MURNI daftar riwayat invoice (read-only) -- tidak ada aksi apa pun lagi di
 *  sini. */
export function InvoiceVendorPanel({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  const [expandedInvoiceId, setExpandedInvoiceId] = useState("");
  const [expandedMrpKey, setExpandedMrpKey] = useState("");
  const [expandedWarnaKey, setExpandedWarnaKey] = useState("");

  const myInvoices = vendorInvoices.filter((i) => i.vendorProduksi === vendorId);

  return (
    <>
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        Invoice diajukan langsung dari halaman Pengiriman — tombol &quot;Submit Invoice&quot; muncul begitu satu grup resi (koli yang dikirim bareng
        ke ekspedisi yang sama) sudah Delivery penuh. Daftar di bawah ini murni riwayat invoice yang sudah diajukan.
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Invoice yang telah dibuat</div>
        <div className="overflow-x-auto">
          <div className="min-w-[1020px]">
            <div
              className="grid items-center gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "110px 1fr 90px 110px 90px 120px 160px" }}
            >
              <span>No Invoice</span>
              <span>MRP</span>
              <span className="text-right">Total qty</span>
              <span>Status</span>
              <span>Tanggal</span>
              <span className="text-right">Total</span>
              <span>Status Payment</span>
            </div>
            {myInvoices.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada invoice.</div>}
            {myInvoices.map((inv) => {
              const invExpanded = expandedInvoiceId === inv.id;
              const totalQtyInv = inv.lines.reduce((s, l) => s + l.qty, 0);
              const payment = vendorInvoicePaymentStatus(inv);
              const finalAmount = vendorInvoiceFinalAmount(inv);
              const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
              const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
              const yieldSummary = invoiceYieldSummary(inv, mrpDetails, productionBatches, productionResults);
              const prodStatus = invoiceProductionStatus(inv, productionGroupMeta, rawInvoices);
              return (
                <div key={inv.id}>
                  <button
                    onClick={() => setExpandedInvoiceId(invExpanded ? "" : inv.id)}
                    className="grid w-full items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]"
                    style={{ gridTemplateColumns: "110px 1fr 90px 110px 90px 120px 160px" }}
                  >
                    <span className="font-mono font-medium">{inv.id}</span>
                    <span>{inv.lines.map((l) => l.mrpId).join(", ")}</span>
                    <span className="text-right font-mono">{formatPcs(totalQtyInv)}</span>
                    <span>
                      <StatusPill tone={vendorInvoiceBadge(inv.status).tone}>{vendorInvoiceBadge(inv.status).label}</StatusPill>
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{inv.submittedAt}</span>
                    <span className="text-right font-mono font-semibold text-[#31414F]">{formatRupiah(inv.totalTagihan)}</span>
                    <span>
                      <StatusPill tone={payment.tone}>{payment.label}</StatusPill>
                    </span>
                  </button>
                  {invExpanded && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-3">
                      <div className="mb-3 grid grid-cols-4 gap-3 rounded-md border border-[#E4E9EE] bg-white p-3">
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Total tagihan</div>
                          <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-[#31414F]">{formatRupiah(inv.totalTagihan)}</div>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Yield</div>
                          <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-[#31414F]">{yieldSummary.yieldPct.toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Status produksi</div>
                          <div className="mt-1">
                            {prodStatus ? (
                              <StatusPill tone={prodStatus.label === "DELAY" ? "danger" : prodStatus.label === "ONTIME" ? "success" : "info"}>
                                {prodStatus.label}
                                {prodStatus.days > 0 ? ` ${prodStatus.days}H` : ""}
                              </StatusPill>
                            ) : (
                              <span className="font-sans text-[11.5px] text-text-muted">—</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Due date</div>
                          <div className="mt-0.5 font-mono text-[12.5px] font-semibold text-[#31414F]">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</div>
                        </div>
                      </div>
                      {(inv.adjustments?.length ?? 0) > 0 && (
                    <div className="mb-3 rounded-md border border-[#E4E9EE] bg-white p-3">
                      <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Penyesuaian dari Procurement</div>
                      {inv.adjustments.map((a) => (
                        <div key={a.id} className="mt-1.5 flex items-center justify-between font-sans text-[11.5px] text-[#31414F]">
                          <span>
                            <span className={a.kind === "DENDA" ? "text-danger-fg" : "text-success-fg"}>{a.kind === "DENDA" ? "Denda" : "Reward"}</span>
                            {" — "}
                            {a.label}
                            {a.note && <span className="text-text-muted"> ({a.note})</span>}
                          </span>
                          <span className="font-mono">
                            {a.kind === "DENDA" ? "−" : "+"}
                            {formatRupiah(a.amount)}
                          </span>
                        </div>
                      ))}
                      <div className="mt-2 flex items-center justify-between border-t border-[#F1F4F7] pt-2 font-sans text-[11.5px] font-semibold text-[#31414F]">
                        <span>Total tagihan akhir</span>
                        <span className="font-mono">{formatRupiah(finalAmount)}</span>
                      </div>
                      <div className="mt-0.5 font-sans text-[10px] text-text-muted">
                        Net tagihan {formatRupiah(inv.netTagihan)} {denda > 0 && `− denda ${formatRupiah(denda)} `}
                        {reward > 0 && `+ reward ${formatRupiah(reward)}`}
                      </div>
                    </div>
                  )}
                  <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Lampiran — detail per MRP</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                    <span>MRP</span>
                    <span className="text-right">Qty diinvoice</span>
                    <span className="text-right">Nilai</span>
                  </div>
                  {inv.lines.map((line) => {
                    const mrpKey = inv.id + "|" + line.mrpId + "|" + line.warna + "|" + line.lengan + "|" + (line.usia ?? "");
                    const mrpExpanded = expandedMrpKey === mrpKey;
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
                            {line.mrpId} <span className="text-[#94A3B0]">({line.warna} · {line.lengan}{line.usia ? " · " + line.usia : ""})</span>
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
                            {/* BUG FIX (2026-09-10, owner-reported): productionYieldByWarna cuma difilter
                                mrpId+vendorProduksi -- mengembalikan SEMUA warna/lengan yang punya batch
                                produksi di MRP ini, bukan cuma warna/lengan baris invoice ini (`line`). Tanpa
                                filter ini, warna LAIN yang kebetulan juga sedang cutting di MRP yang sama (mis.
                                belum FG-confirmed sama sekali, belum pernah dikirim/diinvoice) ikut "bocor"
                                muncul di breakdown baris invoice yang sebenarnya cuma untuk 1 warna/lengan. */}
                            {productionYieldByWarna(line.mrpId, vendorId, mrpDetails, productionBatches, productionResults)
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
