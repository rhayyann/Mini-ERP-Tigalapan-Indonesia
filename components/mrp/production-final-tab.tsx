"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { CloseProductionPoModal } from "@/components/mrp/close-production-po-modal";
import { useMrpStore } from "@/lib/mrp/store";
import {
  cumulativeSizeQtyForGroup,
  cuttingSizesForGroup,
  fgMurniAndReworkForGroup,
  productionGroupMetaFor,
  rejectGrossForGroup,
  reworkBySizeForGroup,
  reworkedAwayBySize,
  reworkQtyForGroup,
  warnaLenganGroupsWithFg,
} from "@/lib/mrp/derive";
import { countProductionFinalReadyForMrp, pendingMarker } from "@/lib/shell/badges";

/** Halaman rekap akhir (satu tempat) sebelum Pengiriman -- gabungan Finish Good + Reject +
 *  Rework per warna/lengan, dengan tombol "Selesai Produksi" TAHAP 2 (final) di sini -- butuh
 *  TAHAP 1 (tombol "Selesai Produksi" di tab Finish Good, yang menghitung reject) sudah dilakukan
 *  duluan. Dua tahap terpisah supaya reject yang baru dihitung di Finish Good masih sempat
 *  dirework sebelum benar-benar final di sini (lihat catatan lengkap di lib/mrp/actions.ts:
 *  confirmFgDoneAction vs markProductionGroupDoneAction). Item 22: TAHAP 2 di sini BUKAN LAGI gate
 *  Pengiriman -- FG sudah shippable sejak TAHAP 1 (lihat banner di bawah). Item 21: "Close PO"
 *  (header, per MRP/PO Produksi terpilih) mengunci SEMUA warna/lengan sekaligus & memblokir
 *  Pengiriman untuk sisa FG yang belum masuk koli. */
export function ProductionFinalTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const markProductionGroupDone = useMrpStore((s) => s.markProductionGroupDone);
  const undoProductionGroupDone = useMrpStore((s) => s.undoProductionGroupDone);
  const closeProductionPo = useMrpStore((s) => s.closeProductionPo);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [expandedGroupKey, setExpandedGroupKey] = useState("");
  const [closePoOpen, setClosePoOpen] = useState(false);

  const mrpIds = Array.from(new Set(productionBatches.filter((b) => b.vendorProduksi === vendorId && b.cuttingAt).map((b) => b.mrpId)));
  // warnaLenganGroupsWithFg (bukan cutWarnaLenganGroups) -- ikutkan grup TUJUAN rework lintas
  // lengan yang tidak pernah dicutting sendiri (lihat catatan di lib/mrp/derive.ts), supaya
  // grup itu tetap bisa di-"Selesai Produksi"-kan & masuk Pengiriman.
  const groups = selectedMrpId ? warnaLenganGroupsWithFg(selectedMrpId, vendorId, productionBatches, productionResults) : [];
  const selectedMaklonPo = selectedMrpId ? maklonPOs.find((p) => p.mrpId === selectedMrpId && p.vendorProduksi === vendorId) : undefined;
  const isPoClosed = !!selectedMaklonPo?.closedAt;

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex-1">
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
                  {pendingMarker(countProductionFinalReadyForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails), "warna/lengan belum final")}
                </option>
              ))}
            </select>
          </div>
          {selectedMaklonPo &&
            (isPoClosed ? (
              <span title={selectedMaklonPo.closeReason}>
                <StatusPill tone="locked">PO DITUTUP</StatusPill>
              </span>
            ) : (
              <button
                onClick={() => setClosePoOpen(true)}
                className="flex-none rounded-md border border-danger px-3 py-[9px] font-sans text-[11.5px] font-semibold text-danger-fg"
              >
                Close PO
              </button>
            ))}
        </div>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP yang sudah dicutting.</div>}
        <div className="mt-2.5 rounded-md border border-[#CFE0EF] bg-info-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-info-fg">
          Rekap Finish Good + Reject + Rework per warna/lengan. Finish Good sudah bisa dikirim begitu &quot;Selesai Produksi&quot; di tab{" "}
          <b>Finish Good</b> (tahap 1) — halaman ini (tahap 2) untuk konfirmasi TERAKHIR (mengunci grup, dasar status tepat waktu/telat), bukan gerbang
          Pengiriman lagi. Pakai <b>Close PO</b> kalau PO Produksi ini mau ditutup lebih awal (sisa Finish Good yang belum masuk koli jadi tidak bisa
          dikirim lagi).
        </div>
      </div>

      {closePoOpen && selectedMaklonPo && (
        <CloseProductionPoModal
          maklonPoId={selectedMaklonPo.id}
          onNo={() => setClosePoOpen(false)}
          onYes={(reason) => {
            closeProductionPo(selectedMaklonPo.id, reason);
            setClosePoOpen(false);
          }}
        />
      )}

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Final Produksi — {selectedMrpId}</div>
          {groups.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada warna yang tercutting untuk MRP ini.</div>}
          {groups.map((g) => {
            const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
            const target = cuttingSizesForGroup(selectedMrpId, g.warna, g.lengan, mrpDetails, productionBatches);
            const fgRecorded = cumulativeSizeQtyForGroup(groupKey, "FG", productionResults);
            const totalTarget = Object.values(target).reduce((a, b) => a + b, 0);
            const totalFg = Object.values(fgRecorded).reduce((a, b) => a + b, 0);
            const totalSelisih = totalFg - totalTarget;
            const progressPct = totalTarget > 0 ? Math.min(100, Math.round((totalFg / totalTarget) * 100)) : 0;
            const grossReject = Object.values(rejectGrossForGroup(groupKey, productionResults)).reduce((a, b) => a + b, 0);
            const sisaReject = Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults)).reduce((a, b) => a + b, 0);
            const rework = reworkQtyForGroup(groupKey, productionResults);
            const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
            const isFgConfirmed = !!meta?.fgConfirmedAt;
            const isDone = !!meta?.doneAt;
            const expanded = expandedGroupKey === groupKey;
            const fgSplit = fgMurniAndReworkForGroup(groupKey, productionResults);
            const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(fgRecorded)]));
            const grossPerSize = rejectGrossForGroup(groupKey, productionResults);
            const reworkPerSize = reworkedAwayBySize(groupKey, productionResults);
            const sisaPerSize = cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults);
            const fgFromReworkPerSize = reworkBySizeForGroup(groupKey, productionResults);
            return (
              <div key={groupKey} className="border-b border-[#F1F4F7] last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-[13px] font-sans text-xs text-[#31414F]">
                  <span className="flex min-w-[160px] items-center gap-1.5 font-medium">
                    {g.warna} · {g.lengan}
                    {isFgConfirmed && <StatusPill tone="success">FG Selesai</StatusPill>}
                    {isDone && <StatusPill tone="success">Final</StatusPill>}
                  </span>
                  <div className="flex min-w-[170px] flex-col gap-1">
                    <div className="flex items-baseline gap-1.5 font-mono text-[11px]">
                      <span className="text-text-muted">FG</span>
                      <span className="font-semibold">{totalFg}</span>
                      <span className="text-text-muted">/ {totalTarget} pcs</span>
                      <span className={"font-semibold " + (totalSelisih < 0 ? "text-danger-fg" : "text-success-fg")}>
                        ({totalSelisih >= 0 ? "+" : ""}
                        {totalSelisih})
                      </span>
                    </div>
                    {fgSplit.rework > 0 && (
                      <span className="font-mono text-[10px] text-text-muted">
                        {fgSplit.murni} murni + {fgSplit.rework} dari rework
                      </span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-full max-w-[130px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                        <span className="block h-full rounded-full bg-success" style={{ width: `${progressPct}%` }} />
                      </span>
                      <span className="font-mono text-[10.5px] text-text-muted">{progressPct}%</span>
                    </div>
                  </div>
                  <span className="font-mono text-[11px]">
                    <span className="text-text-muted">Reject</span> <span className="font-semibold text-danger-fg">{grossReject}</span>
                  </span>
                  <span className="font-mono text-[11px]">
                    <span className="text-text-muted">Rework</span> <span className="font-semibold text-success-fg">{rework}</span>
                  </span>
                  <span className="font-mono text-[11px]">
                    <span className="text-text-muted">Sisa reject</span> <span className="font-semibold text-danger-fg">{sisaReject}</span>
                  </span>
                  <span className="ml-auto flex flex-none items-center gap-2">
                    <button
                      onClick={() => setExpandedGroupKey(expanded ? "" : groupKey)}
                      className="font-sans text-[11px] font-semibold text-action-primary"
                    >
                      {expanded ? "Sembunyikan" : "Lihat by size →"}
                    </button>
                    {isPoClosed ? null : isDone ? (
                      <button
                        onClick={() => undoProductionGroupDone(groupKey)}
                        title="Buka kunci grup ini supaya Finish Good/Reject/Rework bisa dibuka lagi (mulai dari tab Finish Good)"
                        className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-[11px] font-semibold text-action-primary"
                      >
                        Buka kunci ↺
                      </button>
                    ) : isFgConfirmed ? (
                      <button
                        onClick={() => markProductionGroupDone(groupKey, selectedMrpId, vendorId, g.warna, g.lengan)}
                        className="rounded-md bg-action-primary px-3 py-[6px] font-sans text-[11px] font-semibold text-white"
                      >
                        Selesai Produksi
                      </button>
                    ) : (
                      <span className="font-sans text-[10.5px] text-text-muted">Selesaikan dulu Finish Good (tab Finish Good)</span>
                    )}
                  </span>
                </div>
                {expanded && (
                  <div className="border-t border-[#CFE0EF] bg-info-bg p-4">
                    <div className="overflow-x-auto">
                      <div className="min-w-[860px] overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                        <div className="grid grid-cols-8 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                          <span>Size</span>
                          <span className="text-right">FG Target</span>
                          <span className="text-right">FG Terinput</span>
                          <span className="text-right">FG dari Rework</span>
                          <span className="text-right">FG Selisih</span>
                          <span className="text-right">Reject</span>
                          <span className="text-right">Rework</span>
                          <span className="text-right">Sisa Reject</span>
                        </div>
                        {sizes.length === 0 && <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Belum ada size tercatat.</div>}
                        {sizes.map((size) => {
                          const t = target[size] ?? 0;
                          const f = fgRecorded[size] ?? 0;
                          const s = f - t;
                          return (
                            <div key={size} className="grid grid-cols-8 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                              <span className="font-mono font-medium">{size}</span>
                              <span className="text-right font-mono">{t}</span>
                              <span className="text-right font-mono text-text-muted">{f}</span>
                              <span className="text-right font-mono text-success-fg">{fgFromReworkPerSize[size] ?? 0}</span>
                              <span className={"text-right font-mono font-semibold " + (s < 0 ? "text-danger-fg" : "text-success-fg")}>
                                {s >= 0 ? "+" : ""}
                                {s}
                              </span>
                              <span className="text-right font-mono">{grossPerSize[size] ?? 0}</span>
                              <span className="text-right font-mono text-success-fg">{reworkPerSize[size] ?? 0}</span>
                              <span className="text-right font-mono text-danger-fg">{sisaPerSize[size] ?? 0}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
