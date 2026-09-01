"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { NumberInput } from "@/components/mrp/number-input";
import { useMrpStore } from "@/lib/mrp/store";
import {
  formatDate,
  formatPcs,
  formatRupiah,
  invoiceableMrpIdsFullQty,
  invoiceCategoryLabel,
  invoiceProductionStatus,
  invoiceYieldSummary,
  maklonPoInvoiceLockedBy,
  mrpMetaFor,
  productionYieldByWarna,
  productionYieldBySize,
  vendorInvoiceAdjustmentTotal,
  vendorInvoiceBadge,
  vendorInvoiceFinalAmount,
  vendorInvoicePaymentStatus,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { Lengan } from "@/lib/mrp/types";

/** Panel "Invoice Vendor" — konten diekstrak dari halaman lama Invoice & Payment (sekarang
 *  jadi satu sub-tab di halaman yang sama, berdampingan dengan panel "Invoice Maklon"). Alur
 *  invoice PER-PCS delivered × rate (dibatasi kapasitas vendor), direview Procurement dulu
 *  sebelum dibayar Finance — beda dari "Invoice Maklon" yang per-PO base fee. */
export function InvoiceVendorPanel({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const createVendorInvoice = useMrpStore((s) => s.createVendorInvoice);

  const vendorMeta = VENDOR_PRODUKSI[vendorId];
  // Hasil konsultasi tim produksi: invoice diajukan untuk SELURUH qty planned (PO), bukan cuma
  // yang sudah delivery — begitu delivery PERTAMA sudah mulai (lihat hasDeliveryStarted di
  // invoiceableMrpIdsFullQty). Retensi sudah dihapus dari alur (keputusan bisnis terbaru) —
  // pembayaran Finance sekarang cuma sekali lunas penuh, lihat payVendorInvoice di lib/mrp/store.ts.
  // Cegah tagihan ganda: buang baris yang MRP-nya sudah terkunci ke jalur Invoice Maklon
  // (per-PO) — vendor harus lanjut lewat jalur yang sudah dipakai duluan itu.
  const allEligible = invoiceableMrpIdsFullQty(vendorId, mrpDetails, deliveryKolis, vendorInvoices);
  const eligible = allEligible.filter((r) => maklonPoInvoiceLockedBy(r.mrpId, vendorId, maklonInvoices, vendorInvoices) !== "maklon");
  const lockedByMaklonCount = allEligible.length - eligible.length;
  const lineKey = (mrpId: string, warna: string, lengan: string, usia?: string) => mrpId + "|" + warna + "|" + lengan + "|" + (usia ?? "");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [rateByLine, setRateByLine] = useState<Record<string, number>>({});

  const [expandedInvoiceId, setExpandedInvoiceId] = useState("");
  const [expandedMrpKey, setExpandedMrpKey] = useState("");
  const [expandedWarnaKey, setExpandedWarnaKey] = useState("");

  function toggleLine(key: string, maxQty: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        setQtyByLine((q) => ({ ...q, [key]: q[key] ?? maxQty }));
        setRateByLine((r) => ({ ...r, [key]: r[key] ?? (vendorMeta?.ratePerPc ?? 0) }));
      }
      return next;
    });
  }

  const selectedLines = Array.from(selected).map((key) => {
    const src = eligible.find((e) => lineKey(e.mrpId, e.warna, e.lengan, e.usia) === key);
    return {
      mrpId: src?.mrpId ?? key.split("|")[0],
      warna: src?.warna ?? "",
      lengan: src?.lengan ?? "PENDEK",
      usia: src?.usia,
      qty: qtyByLine[key] ?? 0,
      ratePerPc: rateByLine[key] ?? 0,
    };
  });
  const totalQty = selectedLines.reduce((s, l) => s + l.qty, 0);
  const capacity = vendorMeta?.baseCapacity ?? 0;
  const overCapacity = totalQty > capacity;
  const totalTagihan = selectedLines.reduce((s, l) => s + l.qty * l.ratePerPc, 0);

  function submitInvoice() {
    if (selectedLines.length === 0 || overCapacity) return;
    const lines = selectedLines.filter((l) => l.qty > 0);
    if (lines.length === 0) return;
    createVendorInvoice({ vendorProduksi: vendorId, lines });
    setSelected(new Set());
    setQtyByLine({});
    setRateByLine({});
  }

  const myInvoices = vendorInvoices.filter((i) => i.vendorProduksi === vendorId);

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
          Create Invoice — kapasitas vendor {capacity ? formatPcs(capacity) + " pcs" : "—"}
        </div>
        {lockedByMaklonCount > 0 && (
          <div className="border-b border-[#F0DFC2] bg-warning-bg px-4 py-2 font-sans text-[11px] text-warning-fg">
            {lockedByMaklonCount} baris disembunyikan — sudah ditagih via Invoice Maklon (per PO).
          </div>
        )}
        <div className="grid grid-cols-8 gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          <span />
          <span>No MRP</span>
          <span>Kategori</span>
          <span>Warna</span>
          <span>Lengan</span>
          <span className="text-right">Sisa qty planned</span>
          <span className="text-right">Qty diinvoice</span>
          <span className="text-right">Harga maklon / pc</span>
        </div>
        {eligible.length === 0 && (
          <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">
            Belum ada PO yang delivery-nya sudah mulai &amp; masih ada sisa qty planned belum diinvoice.
          </div>
        )}
        {eligible.map(({ mrpId, warna, lengan, usia, uninvoicedQty }) => {
          const key = lineKey(mrpId, warna, lengan, usia);
          const checked = selected.has(key);
          const mrp = mrpMetaFor(mrpId, mrpDetails, staticMrps);
          return (
            <div key={key} className="grid grid-cols-8 items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
              <button
                onClick={() => toggleLine(key, uninvoicedQty)}
                className={"h-3.5 w-3.5 flex-none rounded-[3px] border " + (checked ? "border-accent-blue bg-accent-blue" : "border-[#B8C4D0]")}
              />
              <span className="font-mono">{mrpId}</span>
              <span>{invoiceCategoryLabel(mrp, usia)}</span>
              <span>{warna}</span>
              <span>{lengan}</span>
              <span className="text-right font-mono">{formatPcs(uninvoicedQty)}</span>
              <span className="flex justify-end">
                {checked ? (
                  <NumberInput
                    value={qtyByLine[key] ?? 0}
                    decimals={0}
                    onChange={(v) => setQtyByLine((prev) => ({ ...prev, [key]: Math.max(0, Math.min(v, uninvoicedQty)) }))}
                    className="input w-[100px] text-right"
                  />
                ) : (
                  "—"
                )}
              </span>
              <span className="flex justify-end">
                {checked ? (
                  <NumberInput
                    value={rateByLine[key] ?? 0}
                    decimals={0}
                    onChange={(v) => setRateByLine((prev) => ({ ...prev, [key]: Math.max(0, v) }))}
                    className="input w-[110px] text-right"
                  />
                ) : (
                  "—"
                )}
              </span>
            </div>
          );
        })}

        {selected.size > 0 && (
          <div className="border-t border-[#CFE0EF] bg-info-bg p-4">
            <div className={"font-sans text-xs font-semibold " + (overCapacity ? "text-danger-fg" : "text-info-fg")}>
              Total qty diinvoice: {formatPcs(totalQty)} pcs / kapasitas {formatPcs(capacity)} pcs
              {overCapacity && " — melebihi kapasitas!"}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              <div>
                <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Total invoice</div>
                <div className="input mt-1 flex items-center bg-[#F7F9FB] font-mono font-semibold">{formatRupiah(totalTagihan)}</div>
              </div>
              <div className="col-span-3 flex items-end font-sans text-[10.5px] leading-[1.4] text-text-muted">
                Total invoice dihitung otomatis dari qty × harga maklon per pc dan tidak dapat diubah. Tidak ada retensi — dibayar Finance lunas sekaligus.
              </div>
            </div>
            <div className="mt-3">
              <button
                onClick={submitInvoice}
                disabled={overCapacity}
                className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create Invoice
              </button>
            </div>
          </div>
        )}
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
                            <div className="grid grid-cols-7 gap-2 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                              <span>Warna / lengan</span>
                              <span className="text-right">Qty PO/cutting</span>
                              <span className="text-right">Finish good</span>
                              <span className="text-right">Reject</span>
                              <span className="text-right">Rework</span>
                              <span className="text-right">Yield</span>
                              <span />
                            </div>
                            {productionYieldByWarna(line.mrpId, vendorId, mrpDetails, productionBatches, productionResults).map((r) => {
                              const warnaKey = mrpKey + "|" + r.warna + "|" + r.lengan;
                              const warnaExpanded = expandedWarnaKey === warnaKey;
                              return (
                                <div key={warnaKey}>
                                  <button
                                    onClick={() => setExpandedWarnaKey(warnaExpanded ? "" : warnaKey)}
                                    className="grid w-full grid-cols-7 items-center gap-2 border-t border-[#F1F4F7] py-1.5 text-left font-sans text-[11px] text-[#31414F]"
                                  >
                                    <span>
                                      {r.warna} · {r.lengan}
                                    </span>
                                    <span className="text-right font-mono">{r.cutting}</span>
                                    <span className="text-right font-mono">{r.finishGood}</span>
                                    <span className="text-right font-mono text-danger-fg">{r.reject}</span>
                                    <span className="text-right font-mono text-rework-fg">{r.rework}</span>
                                    <span className="text-right font-mono">{r.yieldPct.toFixed(1)}%</span>
                                    <span className="text-right font-semibold text-action-primary">{warnaExpanded ? "Sembunyikan" : "By size →"}</span>
                                  </button>
                                  {warnaExpanded && (
                                    <div className="ml-3 border-l border-[#DDE4EB] pl-3">
                                      <div className="grid grid-cols-6 gap-2 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                        <span>Size</span>
                                        <span className="text-right">Qty PO/cutting</span>
                                        <span className="text-right">Finish good</span>
                                        <span className="text-right">Reject</span>
                                        <span className="text-right">Rework</span>
                                        <span className="text-right">Yield</span>
                                      </div>
                                      {productionYieldBySize(line.mrpId, r.warna, r.lengan as Lengan, mrpDetails, productionBatches, productionResults).map((s) => (
                                        <div key={s.size} className="grid grid-cols-6 items-center gap-2 border-t border-[#F1F4F7] py-1 font-mono text-[11px] text-[#31414F]">
                                          <span>{s.size}</span>
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
