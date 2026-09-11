"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { CloseProductionPoModal } from "@/components/mrp/close-production-po-modal";
import { useMrpStore } from "@/lib/mrp/store";
import { usePendingActions } from "@/lib/mrp/usePendingActions";
import {
  cumulativeSizeQtyForGroup,
  cuttingSizesForGroup,
  fgMurniAndReworkForGroup,
  openMaterialClaimsForGroup,
  productionGroupMetaFor,
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
  const rawInvoices = useMrpStore((s) => s.invoices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  const materialClaimReplacements = useMrpStore((s) => s.materialClaimReplacements);
  const materialClaimAcceptances = useMrpStore((s) => s.materialClaimAcceptances);
  const markProductionGroupDone = useMrpStore((s) => s.markProductionGroupDone);
  const undoProductionGroupDone = useMrpStore((s) => s.undoProductionGroupDone);
  const closeProductionPo = useMrpStore((s) => s.closeProductionPo);
  const reopenProductionPo = useMrpStore((s) => s.reopenProductionPo);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [expandedGroupKey, setExpandedGroupKey] = useState("");
  const [closePoOpen, setClosePoOpen] = useState(false);
  // Bug fix (2026-09-06): tombol2 di bawah dulu fire-and-forget tanpa .catch -- kalau server
  // menolak, error-nya cuma jadi unhandled rejection di console, tidak pernah terlihat user (lihat
  // catatan lebih lengkap di production-result-panel.tsx, gejala yang sama persis di tab ini).
  const [actionError, setActionError] = useState<string | null>(null);
  // Item revisi 2026-09-07: sama seperti production-result-panel.tsx -- runAction sekarang pakai
  // usePendingActions supaya tombol yang memicunya bisa di-disable + tampil "…" selama request
  // masih berjalan (per-key, bukan 1 flag global).
  const { isPending, run: runKeyed } = usePendingActions();
  function runAction(key: string, promise: Promise<unknown>) {
    setActionError(null);
    runKeyed(key, promise, setActionError);
  }

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
              <span className="flex flex-none items-center gap-2">
                <span title={selectedMaklonPo.closeReason}>
                  <StatusPill tone="locked">PO DITUTUP</StatusPill>
                </span>
                <button
                  onClick={() => runAction(selectedMaklonPo.id, reopenProductionPo(selectedMaklonPo.id))}
                  disabled={isPending(selectedMaklonPo.id)}
                  title="Buka kembali gerbang Pengiriman untuk PO ini -- grup warna/lengan yang sudah terlanjur dikunci Close PO tetap terkunci (buka satu-satu lewat 'Buka kunci ↺' kalau perlu diperbaiki)"
                  className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[9px] font-sans text-[11.5px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending(selectedMaklonPo.id) ? "Membuka…" : "Buka kembali PO"}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setClosePoOpen(true)}
                disabled={isPending(selectedMaklonPo.id)}
                className="flex-none rounded-md border border-danger px-3 py-[9px] font-sans text-[11.5px] font-semibold text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending(selectedMaklonPo.id) ? "Menutup…" : "Close PO"}
              </button>
            ))}
        </div>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP yang sudah dicutting.</div>}
        {actionError && (
          <div className="mt-2.5 flex items-start justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="flex-none font-semibold underline">
              Tutup
            </button>
          </div>
        )}
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
            runAction(selectedMaklonPo.id, closeProductionPo(selectedMaklonPo.id, reason));
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
            // Item revisi 2026-09-08 (owner: "Hilangkan saja yang reject, pake saja reject sisa
            // jadi reject saat ini") -- dulu tampil DUA angka reject berdampingan (gross sebelum
            // rework + sisa setelah rework), sekarang cukup SATU: sisa reject SAAT INI (setelah
            // rework dikurangkan), diberi label "Reject" biasa (bukan lagi "Sisa reject").
            const currentReject = Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults)).reduce((a, b) => a + b, 0);
            const rework = reworkQtyForGroup(groupKey, productionResults);
            const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
            const isFgConfirmed = !!meta?.fgConfirmedAt;
            const isDone = !!meta?.doneAt;
            const expanded = expandedGroupKey === groupKey;
            const fgSplit = fgMurniAndReworkForGroup(groupKey, productionResults);
            const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(fgRecorded)]));
            const reworkPerSize = reworkedAwayBySize(groupKey, productionResults);
            const currentRejectPerSize = cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults);
            const fgFromReworkPerSize = reworkBySizeForGroup(groupKey, productionResults);
            // BUG FIX (2026-09-12, user-reported): "Selesai Produksi" (tahap 2) BUKAN gate
            // Pengiriman lagi -- FG sudah shippable sejak tahap 1 -- jadi tidak ada alasan
            // buru-buru mengunci tahap 2 selama masih ada klaim material yang belum selesai untuk
            // warna/lengan ini (roll penggantinya bisa jadi masih "dalam perjalanan" lewat proses
            // klaim, dan begitu tahap 2 terkunci, roll baru itu TIDAK BISA lagi di-cutting --
            // lihat guard done_at di updateBatchToCuttingAction). Warning, bukan hard-block --
            // vendor tetap boleh lanjut kalau memang yakin klaimnya tidak relevan lagi.
            const openClaims = openMaterialClaimsForGroup(
              selectedMrpId,
              vendorId,
              g.warna,
              g.lengan,
              rawInvoices,
              materialClaimResolutions,
              materialClaimReturRequests,
              materialClaimReturDeliveries,
              materialClaimReturReceipts,
              materialClaimReplacements,
              materialClaimAcceptances
            );
            function confirmAndMarkDone() {
              if (
                openClaims.length > 0 &&
                !window.confirm(
                  `Grup ${g.warna} · ${g.lengan} masih punya ${openClaims.length} klaim material yang belum selesai (roll pengganti bisa jadi masih dalam proses). Setelah "Selesai Produksi", roll BARU untuk warna/lengan ini tidak akan bisa di-cutting lagi kecuali dibuka kunci dulu. Tetap lanjutkan?`
                )
              ) {
                return;
              }
              runAction(groupKey, markProductionGroupDone(groupKey, selectedMrpId, vendorId, g.warna, g.lengan));
            }
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
                    <span className="text-text-muted">Rework</span> <span className="font-semibold text-success-fg">{rework}</span>
                  </span>
                  <span className="font-mono text-[11px]">
                    <span className="text-text-muted">Reject</span> <span className="font-semibold text-danger-fg">{currentReject}</span>
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
                        onClick={() => runAction(groupKey, undoProductionGroupDone(groupKey))}
                        disabled={isPending(groupKey)}
                        title="Buka kunci grup ini supaya Finish Good/Reject/Rework bisa dibuka lagi (mulai dari tab Finish Good)"
                        className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[6px] font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending(groupKey) ? "Membuka…" : "Buka kunci ↺"}
                      </button>
                    ) : isFgConfirmed ? (
                      <button
                        onClick={confirmAndMarkDone}
                        disabled={isPending(groupKey)}
                        title={openClaims.length > 0 ? `${openClaims.length} klaim material grup ini belum selesai -- akan diminta konfirmasi dulu` : undefined}
                        className="rounded-md bg-action-primary px-3 py-[6px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending(groupKey) ? "Menyimpan…" : openClaims.length > 0 ? `Selesai Produksi ⚠ ${openClaims.length} klaim aktif` : "Selesai Produksi"}
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
                        <div className="grid grid-cols-7 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                          <span>Size</span>
                          <span className="text-right">FG Target</span>
                          <span className="text-right">FG Terinput</span>
                          <span className="text-right">FG dari Rework</span>
                          <span className="text-right">FG Selisih</span>
                          <span className="text-right">Rework</span>
                          <span className="text-right">Reject</span>
                        </div>
                        {sizes.length === 0 && <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Belum ada size tercatat.</div>}
                        {sizes.map((size) => {
                          const t = target[size] ?? 0;
                          const f = fgRecorded[size] ?? 0;
                          const s = f - t;
                          return (
                            <div key={size} className="grid grid-cols-7 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                              <span className="font-mono font-medium">{size}</span>
                              <span className="text-right font-mono">{t}</span>
                              <span className="text-right font-mono text-text-muted">{f}</span>
                              <span className="text-right font-mono text-success-fg">{fgFromReworkPerSize[size] ?? 0}</span>
                              <span className={"text-right font-mono font-semibold " + (s < 0 ? "text-danger-fg" : "text-success-fg")}>
                                {s >= 0 ? "+" : ""}
                                {s}
                              </span>
                              <span className="text-right font-mono text-success-fg">{reworkPerSize[size] ?? 0}</span>
                              <span className="text-right font-mono text-danger-fg">{currentRejectPerSize[size] ?? 0}</span>
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
