"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import {
  cumulativeSizeQtyForGroup,
  fgMurniAndReworkForGroup,
  formatDate,
  formatDateTimeShort,
  productionGroupMetaFor,
  rejectGrossForGroup,
  reworkBySizeForGroup,
  reworkedAwayBySize,
  reworkQtyForGroup,
  targetDoneProduksiForGroup,
  cuttingSizesForGroup,
  warnaLenganGroupsWithFg,
  wasteQtyForGroup,
  wastedAwayBySize,
} from "@/lib/mrp/derive";
import type { ProductionResult } from "@/lib/mrp/types";

// FG: Warna/lengan | Progres (target+terinput+bar digabung jadi satu kolom, bukan 3 kolom
// sempit terpisah — jauh lebih mudah dipindai sekilas) | Target done produksi | Aksi.
// Tombol "Selesai Produksi" DI SINI (tab Finish Good) = TAHAP 1 dari 2 -- hitung reject &
// kunci input FG, tapi BELUM mengunci Rework/Waste (itu tahap 2, tab Final Produksi, lihat
// production-final-tab.tsx). Dua tahap terpisah supaya reject yang baru dihitung masih sempat
// dirework sebelum benar-benar final.
const FG_COLUMNS = "minmax(170px,1.3fr) minmax(190px,1.5fr) minmax(150px,1fr) minmax(160px,1fr)";
// REJECT: tiap angka (target/awal/sisa/waste) tetap bermakna terpisah, jadi tetap kolom angka
// masing-masing — Sisa/Waste ditambah supaya reject yang dibuang (bukan dirework) kelihatan
// terpisah dari yang masih jadi rework.
const REJECT_COLUMNS = "minmax(170px,1.3fr) minmax(130px,0.9fr) minmax(110px,0.7fr) minmax(110px,0.7fr) minmax(130px,0.9fr) minmax(130px,0.9fr)";

/** Riwayat tiap submission Finish Good untuk 1 grup warna/lengan — diminta supaya progres
 *  pengerjaan bisa dilihat per-hari/jam (co: "Senin 60, Selasa 60"), bukan cuma total kumulatif.
 *  `recordedAt` (tanggal + jam) SELALU dari jam sistem saat submit (lihat nowIso() di
 *  lib/mrp/store.ts) — tidak ada field tanggal/jam yang bisa diisi manual di form manapun, jadi
 *  tidak mungkin backdate. Diurutkan kronologis (lama → baru) supaya kebaca sebagai timeline. */
function FgProgressHistory({ poId, results }: { poId: string; results: ProductionResult[] }) {
  // Di-scope per PO Produksi (bukan per grup warna/lengan lagi) — 1 PO bisa punya beberapa warna,
  // jadi tiap baris riwayat sekarang juga nampilin warna · lengan-nya supaya tetap jelas
  // submission itu punya bagian warna mana kalau PO-nya multi-warna.
  const entries = results.filter((r) => r.poId === poId && r.kind === "FG").sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {entries.map((r) => {
        const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
        // Rincian size mana saja yang ke-input di submission ini — 1 klik "Simpan hasil
        // produksi" bisa sekaligus isi beberapa size, jadi total qty saja tidak cukup untuk
        // tahu size apa yang benar-benar dikerjakan tanggal/jam itu.
        const sizeBreakdown = Object.entries(r.sizeQty)
          .filter(([, q]) => q !== 0)
          .map(([size, q]) => `${size} +${q}`)
          .join(", ");
        return (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-[#EEF1F4] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
            <span className="flex items-center gap-2">
              <span className="font-mono text-text-muted">{formatDateTimeShort(r.recordedAt)}</span>
              <span className="font-medium">
                {r.warna} · {r.lengan}
              </span>
              {r.note && <span className="text-[10px] text-text-muted">({r.note})</span>}
            </span>
            <span className="flex flex-col items-end">
              <span className="font-mono font-semibold text-success-fg">+{qty} pcs</span>
              <span className="font-mono text-[10px] text-text-muted">{sizeBreakdown}</span>
            </span>
            </div>
          );
        })}
      </div>
  );
}

export function ProductionResultPanel({ vendorId, kind, title }: { vendorId: string; kind: "FG" | "REJECT"; title: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const rejectRemarks = useMrpStore((s) => s.rejectRemarks);
  const submitProductionResult = useMrpStore((s) => s.submitProductionResult);
  const setRejectRemark = useMrpStore((s) => s.setRejectRemark);
  const confirmFgDone = useMrpStore((s) => s.confirmFgDone);
  const undoFgConfirm = useMrpStore((s) => s.undoFgConfirm);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [expandedGroupKey, setExpandedGroupKey] = useState("");
  const [sizeDraft, setSizeDraft] = useState<Record<string, number>>({});
  const [expandedPoId, setExpandedPoId] = useState("");

  const mrpIds = Array.from(new Set(productionBatches.filter((b) => b.vendorProduksi === vendorId && b.cuttingAt).map((b) => b.mrpId)));
  // warnaLenganGroupsWithFg (bukan cutWarnaLenganGroups) -- ikutkan grup TUJUAN rework lintas
  // lengan yang tidak pernah dicutting sendiri (lihat catatan di lib/mrp/derive.ts), supaya FG
  // hasil rework itu punya baris sendiri yang bisa di-"Selesai Produksi"-kan juga.
  const groups = selectedMrpId ? warnaLenganGroupsWithFg(selectedMrpId, vendorId, productionBatches, productionResults) : [];
  const gridColumns = kind === "FG" ? FG_COLUMNS : REJECT_COLUMNS;

  function toggleGroup(warna: string, lengan: string) {
    const key = selectedMrpId + "|" + warna + "|" + lengan;
    if (expandedGroupKey === key) {
      setExpandedGroupKey("");
    } else {
      setExpandedGroupKey(key);
      setSizeDraft({});
    }
  }

  function submitGroup(warna: string, lengan: "PENDEK" | "PANJANG") {
    const sizeQty: Record<string, number> = {};
    for (const [size, qty] of Object.entries(sizeDraft)) {
      if (qty) sizeQty[size] = qty;
    }
    if (Object.keys(sizeQty).length === 0) return;
    submitProductionResult({ mrpId: selectedMrpId, vendorProduksi: vendorId, warna, lengan, kind, sizeQty });
    setExpandedGroupKey("");
    setSizeDraft({});
  }

  const myResults = productionResults.filter((r) => r.vendorProduksi === vendorId && r.kind === kind);
  const poIds = Array.from(new Set(myResults.map((r) => r.poId).filter(Boolean)));

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP (sudah tercutting)</div>
        <select
          value={selectedMrpId}
          onChange={(e) => {
            setSelectedMrpId(e.target.value);
            setExpandedGroupKey("");
          }}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {mrpIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP yang sudah dicutting.</div>}
      </div>

      {kind === "FG" && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Ada 2 tahap &quot;Selesai Produksi&quot;: <b>(1) di sini</b> — begitu input Finish Good untuk 1 warna/lengan sudah final, reject langsung dihitung otomatis
          (hasil cutting dikurangi Finish Good), tapi Rework/Buang ke Sisa TETAP bisa jalan pakai reject itu. <b>(2) di tab Final Produksi</b> — dilakukan
          SETELAH rework (kalau ada) juga selesai, benar-benar mengunci semuanya & baru di titik itu hasilnya boleh masuk Pengiriman.
        </div>
      )}

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
            {title} — {selectedMrpId}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div
                className="grid items-center gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
                style={{ gridTemplateColumns: gridColumns }}
              >
                <span>Warna / lengan</span>
                {kind === "REJECT" ? (
                  <>
                    <span className="text-right">Reject Produksi</span>
                    <span className="text-right">Reject (Final)</span>
                    <span className="text-right">Rework</span>
                    <span className="text-right">Sisa/Waste</span>
                  </>
                ) : (
                  <>
                    <span>Progres</span>
                    <span>Target done produksi</span>
                  </>
                )}
                <span className="text-right">Aksi</span>
              </div>
              {groups.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada warna yang tercutting untuk MRP ini.</div>}
              {groups.map((g) => {
                const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
                // Total Qty sekarang dari hasil aduan AKTUAL yang diinput vendor per roll di
                // Cutting (cuttingSizesForGroup), bukan lagi murni estimasi rasio dari target MRP —
                // fallback otomatis ke estimasi lama kalau grup ini belum ada batch yang diisi.
                const target = cuttingSizesForGroup(selectedMrpId, g.warna, g.lengan, mrpDetails, productionBatches);
                const recorded = cumulativeSizeQtyForGroup(groupKey, kind, productionResults);
                const totalCuttingTarget = Object.values(target).reduce((a, b) => a + b, 0);
                const totalRecorded = Object.values(recorded).reduce((a, b) => a + b, 0);
                const totalFgRecorded = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", productionResults)).reduce((a, b) => a + b, 0);
                // Target reject = sisa dari target finish good (target cutting dikurangi FG yang sudah diinput).
                const totalTarget = kind === "REJECT" ? Math.max(0, totalCuttingTarget - totalFgRecorded) : totalCuttingTarget;
                const grossReject = kind === "REJECT" ? Object.values(rejectGrossForGroup(groupKey, productionResults)).reduce((a, b) => a + b, 0) : 0;
                const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(recorded)]));
                const expanded = expandedGroupKey === groupKey;
                const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
                // isFgConfirmed = TAHAP 1 (tab ini) sudah diklik -- reject sudah dihitung, input FG
                // dikunci, tapi Rework/Waste TETAP bisa jalan. isFinalDone = TAHAP 2 (Final Produksi)
                // sudah diklik -- semuanya benar-benar dikunci.
                const isFgConfirmed = !!meta?.fgConfirmedAt;
                const isFinalDone = !!meta?.doneAt;
                const targetDoneAt = kind === "FG" ? targetDoneProduksiForGroup(selectedMrpId, vendorId, g.warna, rawInvoices) : undefined;
                const progressPct = totalTarget > 0 ? Math.min(100, Math.round((totalRecorded / totalTarget) * 100)) : 0;
                // Finish Good murni (hasil cutting langsung) vs dari rework (reject dipotong ulang
                // jadi baju) -- contoh: murni 100, dirework 3, totalnya tampil 103 (100 murni + 3
                // rework), diminta supaya kelihatan jelas asalnya masing-masing.
                const fgSplit = kind === "FG" ? fgMurniAndReworkForGroup(groupKey, productionResults) : null;
                return (
                  <div key={groupKey}>
                    <div
                      className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]"
                      style={{ gridTemplateColumns: gridColumns }}
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">
                          {g.warna} · {g.lengan}
                        </span>
                        {isFgConfirmed && <StatusPill tone="success">FG Selesai</StatusPill>}
                        {isFinalDone && <StatusPill tone="success">Final</StatusPill>}
                      </span>
                      {kind === "REJECT" ? (
                        <>
                          <span className="text-right font-mono">{grossReject}</span>
                          <span className="text-right font-mono text-danger-fg">{totalRecorded}</span>
                          <span className="text-right font-mono text-success-fg">
                            {Object.values(reworkedAwayBySize(groupKey, productionResults)).reduce((a, b) => a + b, 0)}
                          </span>
                          <span className="text-right font-mono text-warning-fg">{wasteQtyForGroup(groupKey, productionResults)}</span>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-baseline gap-1 font-mono text-[12px]">
                              <span className="font-semibold text-[#31414F]">{totalRecorded}</span>
                              <span className="text-text-muted">/ {totalTarget} pcs</span>
                            </div>
                            {!!fgSplit?.rework && (
                              <span className="font-mono text-[10px] text-text-muted">
                                ({fgSplit.murni} murni + {fgSplit.rework} dari rework)
                              </span>
                            )}
                            <div className="flex items-center gap-1.5">
                              <span className="h-1.5 w-full max-w-[130px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                                <span className="block h-full rounded-full bg-success" style={{ width: `${progressPct}%` }} />
                              </span>
                              <span className="font-mono text-[10.5px] text-text-muted">{progressPct}%</span>
                            </div>
                          </div>
                          <span className="font-mono text-[11px] text-text-muted">{targetDoneAt ? formatDate(targetDoneAt) : "— (belum ada material diterima)"}</span>
                        </>
                      )}
                      <span className="flex flex-col items-end gap-1 text-right">
                        <button onClick={() => toggleGroup(g.warna, g.lengan)} className="font-sans text-[11px] font-semibold text-action-primary">
                          {expanded ? "Sembunyikan" : "Lihat by size →"}
                        </button>
                        {kind === "FG" &&
                          (isFgConfirmed ? (
                            !isFinalDone && (
                              <button onClick={() => undoFgConfirm(groupKey)} className="font-sans text-[10.5px] font-semibold text-action-primary underline">
                                Buka kunci ↺
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => confirmFgDone(groupKey, selectedMrpId, vendorId, g.warna, g.lengan)}
                              className="flex-none rounded-md bg-action-primary px-2.5 py-[5px] font-sans text-[11px] font-semibold text-white"
                            >
                              Selesai Produksi
                            </button>
                          ))}
                      </span>
                    </div>
                    {expanded && !isFgConfirmed && kind === "REJECT" && (
                      <div className="border-b border-[#F0DFC2] bg-warning-bg px-4 py-3 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
                        Reject grup ini belum dihitung — tidak ada input manual lagi. Tandai {g.warna} · {g.lengan} &quot;Selesai Produksi&quot; di tab Finish
                        Good supaya reject dihitung otomatis dari hasil cutting dikurangi finish good.
                      </div>
                    )}
                    {expanded && isFgConfirmed && kind === "REJECT" && (
                      <div className="border-b border-[#CFE0EF] bg-info-bg p-4">
                        <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                          <div className="grid grid-cols-5 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            <span>Size</span>
                            <span className="text-right">Reject (otomatis)</span>
                            <span className="text-right">Rework</span>
                            <span className="text-right">Sisa/Waste</span>
                            <span className="text-right">Sisa reject</span>
                          </div>
                          {(() => {
                            const grossPerSize = rejectGrossForGroup(groupKey, productionResults);
                            const reworkPerSize = reworkedAwayBySize(groupKey, productionResults);
                            const wastePerSize = wastedAwayBySize(groupKey, productionResults);
                            const rejectSizes = sizes.filter((size) => (grossPerSize[size] ?? 0) > 0 || (reworkPerSize[size] ?? 0) > 0 || (wastePerSize[size] ?? 0) > 0);
                            if (rejectSizes.length === 0) {
                              return <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Tidak ada reject — finish good sudah mencapai target.</div>;
                            }
                            return rejectSizes.map((size) => (
                              <div key={size} className="grid grid-cols-5 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                                <span className="font-mono font-medium">{size}</span>
                                <span className="text-right font-mono">{grossPerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-success-fg">{reworkPerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-warning-fg">{wastePerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-danger-fg">{recorded[size] ?? 0}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                    {expanded && !isFgConfirmed && kind === "FG" && (
                      <div className="border-b border-[#CFE0EF] bg-info-bg p-4">
                        <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                          <div className="grid grid-cols-5 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            <span>Size</span>
                            <span className="text-right">Target</span>
                            <span className="text-right">Qty sudah diinput</span>
                            <span className="text-right">Selisih</span>
                            <span className="text-right">Input</span>
                          </div>
                          {sizes.map((size) => {
                            // Selisih = qty sudah diinput - target -- merah + tanda "-" kalau
                            // masih kurang dari target, hijau + tanda "+" kalau sudah pas/lebih.
                            const selisih = (recorded[size] ?? 0) - (target[size] ?? 0);
                            return (
                              <div key={size} className="grid grid-cols-5 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                                <span className="font-mono font-medium">{size}</span>
                                <span className="text-right font-mono">{target[size] ?? 0}</span>
                                <span className="text-right font-mono text-text-muted">{recorded[size] ?? 0}</span>
                                <span className={"text-right font-mono font-semibold " + (selisih < 0 ? "text-danger-fg" : "text-success-fg")}>
                                  {selisih >= 0 ? "+" : ""}
                                  {selisih}
                                </span>
                                <span className="flex justify-end">
                                  <NumberInput
                                    value={sizeDraft[size] ?? 0}
                                    decimals={0}
                                    onChange={(v) => setSizeDraft((prev) => ({ ...prev, [size]: v }))}
                                    className="input w-[90px] text-right"
                                  />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2.5">
                          <button onClick={() => submitGroup(g.warna, g.lengan)} className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white">
                            Simpan hasil produksi
                          </button>
                        </div>
                      </div>
                    )}
                    {expanded && isFgConfirmed && kind === "FG" && (
                      <div className="border-b border-[#CFE0EF] bg-info-bg p-4">
                        <div className="mb-2 font-sans text-[11px] text-info-fg">
                          FG sudah dikunci (tahap 1) — read-only. Baris &quot;Dari rework&quot; bisa terus bertambah kalau ada reject dari grup lain yang
                          dirework ke sini.
                        </div>
                        <div className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                          <div className="grid grid-cols-4 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            <span>Size</span>
                            <span className="text-right">Target</span>
                            <span className="text-right">Total</span>
                            <span className="text-right">Murni / Dari rework</span>
                          </div>
                          {(() => {
                            const reworkPerSize = reworkBySizeForGroup(groupKey, productionResults);
                            return sizes.map((size) => {
                              const total = recorded[size] ?? 0;
                              const rw = reworkPerSize[size] ?? 0;
                              return (
                                <div key={size} className="grid grid-cols-4 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                                  <span className="font-mono font-medium">{size}</span>
                                  <span className="text-right font-mono">{target[size] ?? 0}</span>
                                  <span className="text-right font-mono font-semibold">{total}</span>
                                  <span className="text-right font-mono text-[11px] text-text-muted">
                                    {total - rw} murni{rw > 0 ? ` + ${rw} rework` : ""}
                                  </span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">
          {kind === "REJECT" ? "Detail Reject — by PO" : "Riwayat & Hasil Finish Good — by PO"}
        </div>
        <div className="overflow-x-auto">
          <div className={kind === "REJECT" ? "min-w-[900px]" : "min-w-[600px]"}>
            <div
              className="grid items-center gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{
                gridTemplateColumns:
                  kind === "REJECT"
                    ? "minmax(90px,0.7fr) minmax(120px,0.9fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(110px,0.8fr) minmax(160px,1.5fr) minmax(90px,0.7fr)"
                    : "minmax(100px,1fr) minmax(120px,1fr) minmax(100px,0.8fr) minmax(90px,0.7fr)",
              }}
            >
              <span>No MRP</span>
              <span>No PO Produksi</span>
              {kind === "REJECT" ? (
                <>
                  <span className="text-right">Qty reject</span>
                  <span className="text-right">Qty rework</span>
                  <span className="text-right">Qty waste</span>
                  <span className="text-right">Qty sisa reject</span>
                  <span>Remark sisa reject</span>
                </>
              ) : (
                <span className="text-right">Total qty</span>
              )}
              <span className="text-right">Detail</span>
            </div>
            {poIds.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada hasil produksi tercatat.</div>}
            {poIds.map((poId) => {
              const rows = myResults.filter((r) => r.poId === poId);
              const total = rows.reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0);
              const expanded = expandedPoId === poId;
              const mrpId = rows[0]?.mrpId ?? "—";
              const byWarna = new Map<string, number>();
              for (const r of rows) {
                const key = r.warna + " · " + r.lengan;
                const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
                byWarna.set(key, (byWarna.get(key) ?? 0) + qty);
              }
              // Qty reject (gross, sebelum rework): entri REJECT tanpa note (submission asli, bukan penyesuaian rework).
              const qtyRejectGross = kind === "REJECT" ? rows.filter((r) => !r.note).reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0) : 0;
              // Qty rework: jumlah warna/lengan unik pada PO ini dijumlahkan via reworkQtyForGroup.
              const qtyRework =
                kind === "REJECT"
                  ? Array.from(new Set(rows.map((r) => r.groupKey))).reduce((sum, gk) => sum + reworkQtyForGroup(gk, productionResults), 0)
                  : 0;
              // Qty waste: entri kind "WASTE" (bukan REJECT) untuk PO ini — lihat wasteRejectSizeAction.
              const qtyWaste =
                kind === "REJECT"
                  ? productionResults
                      .filter((r) => r.vendorProduksi === vendorId && r.kind === "WASTE" && r.poId === poId)
                      .reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0)
                  : 0;
              const qtySisaReject = total; // net (gross - rework - waste) — sama dengan total sizeQty semua entri REJECT PO ini.
              return (
                <div key={poId}>
                  <div
                    className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]"
                    style={{
                      gridTemplateColumns:
                        kind === "REJECT"
                          ? "minmax(90px,0.7fr) minmax(120px,0.9fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(110px,0.8fr) minmax(160px,1.5fr) minmax(90px,0.7fr)"
                          : "minmax(100px,1fr) minmax(120px,1fr) minmax(100px,0.8fr) minmax(90px,0.7fr)",
                    }}
                  >
                    <span className="font-mono">{mrpId}</span>
                    <span className="font-mono font-medium">{poId}</span>
                    {kind === "REJECT" ? (
                      <>
                        <span className="text-right font-mono">{qtyRejectGross}</span>
                        <span className="text-right font-mono">{qtyRework}</span>
                        <span className="text-right font-mono text-warning-fg">{qtyWaste}</span>
                        <span className="text-right font-mono text-danger-fg">{qtySisaReject}</span>
                        <input
                          value={rejectRemarks[poId] ?? ""}
                          onChange={(e) => setRejectRemark(poId, e.target.value)}
                          placeholder="Catatan sisa reject…"
                          className="input text-[11.5px]"
                        />
                      </>
                    ) : (
                      <span className="text-right font-mono">{total}</span>
                    )}
                    <span className="text-right">
                      <button onClick={() => setExpandedPoId(expanded ? "" : poId)} className="font-sans text-[11px] font-semibold text-action-primary">
                        {expanded ? "Sembunyikan" : "Detail →"}
                      </button>
                    </span>
                  </div>
                  {expanded && kind === "REJECT" && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-2">
                      {Array.from(byWarna.entries()).map(([warna, qty]) => (
                        <div key={warna} className="flex justify-between py-1 font-sans text-[11.5px] text-[#31414F]">
                          <span>{warna}</span>
                          <span className="font-mono">{qty}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {expanded && kind === "FG" && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-6 py-2.5">
                      <div className="mb-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                        Tanggal &amp; jam tercatat otomatis oleh sistem, tidak bisa diubah/backdate
                      </div>
                      <FgProgressHistory poId={poId} results={productionResults} />
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
