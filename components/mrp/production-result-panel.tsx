"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { usePendingActions } from "@/lib/mrp/usePendingActions";
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
} from "@/lib/mrp/derive";
import { countFgShortfallGroupsForMrp, countRejectActionableGroupsForMrp, pendingMarker } from "@/lib/shell/badges";
import type { ProductionResult } from "@/lib/mrp/types";

// FG: Warna/lengan | Progres (target+terinput+bar digabung jadi satu kolom, bukan 3 kolom
// sempit terpisah — jauh lebih mudah dipindai sekilas) | Target done produksi | Aksi.
// Tombol "Selesai Produksi" DI SINI (tab Finish Good) = TAHAP 1 dari 2 -- hitung reject &
// kunci input FG, tapi BELUM mengunci Rework/Waste (itu tahap 2, tab Final Produksi, lihat
// production-final-tab.tsx). Dua tahap terpisah supaya reject yang baru dihitung masih sempat
// dirework sebelum benar-benar final.
const FG_COLUMNS = "minmax(170px,1.3fr) minmax(190px,1.5fr) minmax(150px,1fr) minmax(160px,1fr)";
// REJECT: tiap angka (target/awal/sisa) tetap bermakna terpisah, jadi tetap kolom angka
// masing-masing. Kolom "Sisa/Waste" DIHAPUS (item 19 -- "Buang ke Sisa" dihapus dari flow).
const REJECT_COLUMNS = "minmax(170px,1.3fr) minmax(130px,0.9fr) minmax(110px,0.7fr) minmax(110px,0.7fr) minmax(130px,0.9fr)";

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
  const setRejectRemark = useMrpStore((s) => s.setRejectRemark);
  const confirmFgDone = useMrpStore((s) => s.confirmFgDone);
  const undoFgConfirm = useMrpStore((s) => s.undoFgConfirm);
  // Revisi 2026-09-07 (HPP per roll) -- "Tutup Roll" per ProductionBatch (roll), lihat
  // closeProductionBatchAction. Menggantikan input size bebas per grup untuk kind="FG".
  const closeProductionBatch = useMrpStore((s) => s.closeProductionBatch);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [expandedGroupKey, setExpandedGroupKey] = useState("");
  // Qty FG aktual per roll, keyed by ProductionBatch id -> { size: qty } -- prefill dari
  // batch.sizeQty (hasil cutting AKTUAL roll itu) begitu grup di-expand, lihat toggleGroup.
  const [fgSizeDraft, setFgSizeDraft] = useState<Record<string, Record<string, number>>>({});
  const [expandedPoId, setExpandedPoId] = useState("");
  // Bug fix (2026-09-06): confirmFgDone/undoFgConfirm dulu dipanggil fire-and-forget (tanpa
  // .catch) -- kalau server menolak (mis. baseline hasil cutting dikira kosong, lihat fix di
  // lib/mrp/actions.ts fetchProductionScopeForMrp), promise-nya cuma jadi unhandled rejection di
  // console browser, TIDAK PERNAH terlihat user -- tombol "Selesai Produksi" tampak seperti tidak
  // melakukan apa-apa sama sekali. Sekarang errornya ditangkap & ditampilkan di banner.
  const [actionError, setActionError] = useState<string | null>(null);
  // Item revisi 2026-09-07 (owner: "Tutup Roll" & aksi lain terasa lambat -- tidak ada tanda
  // loading sama sekali sebelum ini): runAction dulu MURNI penangkap error, sekarang pakai
  // usePendingActions supaya tombol yang memicunya bisa di-disable + tampil "…" selama request
  // masih berjalan (per-key, bukan 1 flag global -- banyak roll/grup independen di daftar yang
  // sama tidak saling mengunci). `key` = identitas unik aksi itu (mis. batch id / groupKey).
  const { isPending, run: runKeyed } = usePendingActions();
  function runAction(key: string, promise: Promise<unknown>) {
    setActionError(null);
    runKeyed(key, promise, setActionError);
  }

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
      setFgSizeDraft({});
    }
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
          {mrpIds.map((id) => {
            // Item 3: unit/predikat beda per kind -- FG pakai countFgShortfallGroupsForMrp
            // ("warna/lengan belum lengkap"), REJECT pakai countRejectActionableGroupsForMrp
            // ("warna/lengan ada sisa reject") -- sama predikat dengan badge tab masing-masing.
            const n =
              kind === "FG"
                ? countFgShortfallGroupsForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails)
                : countRejectActionableGroupsForMrp(id, vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails);
            return (
              <option key={id} value={id}>
                {id}
                {pendingMarker(n, kind === "FG" ? "warna/lengan belum lengkap" : "warna/lengan ada sisa reject")}
              </option>
            );
          })}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP yang sudah dicutting.</div>}
      </div>

      {actionError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="flex-none font-semibold underline">
            Tutup
          </button>
        </div>
      )}

      {kind === "FG" && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Ada 2 tahap &quot;Selesai Produksi&quot;: <b>(1) di sini</b> — begitu input Finish Good untuk 1 warna/lengan sudah final, reject langsung dihitung
          otomatis (hasil cutting dikurangi Finish Good) DAN hasilnya <b>langsung boleh masuk Pengiriman</b> — Rework TETAP bisa jalan pakai reject itu
          sesudahnya, dan rework yang terkumpul nanti ikut ke koli berikutnya. <b>(2) di tab Final Produksi</b> — dilakukan SETELAH rework (kalau ada) juga
          selesai, benar-benar mengunci grup ini (tidak bisa berubah lagi) sebagai basis status tepat waktu/telat — bukan gerbang Pengiriman lagi. Pakai
          <b> Close PO</b> di tab Final Produksi kalau PO Produksi ini mau ditutup lebih awal (sisa Finish Good yang belum masuk koli jadi tidak bisa dikirim
          lagi).
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
                // Revisi 2026-09-07 (HPP per roll) -- roll (ProductionBatch) tercutting grup ini,
                // dipakai buat daftar "Tutup Roll" DAN gate tombol "Selesai Produksi" (cuma boleh
                // begitu SEMUA roll grup ini sudah ditutup). Grup tanpa roll cutting sama sekali
                // (murni tujuan rework lintas lengan, lihat warnaLenganGroupsWithFg) tetap boleh
                // confirm tanpa gate -- sama seperti guard di confirmFgDoneAction.
                const groupBatches = kind === "FG" ? productionBatches.filter((b) => b.mrpId === selectedMrpId && b.warna === g.warna && b.lengan === g.lengan && b.cuttingAt) : [];
                const allRollsClosed = groupBatches.length === 0 || groupBatches.every((b) => b.closedAt);
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
                              <button
                                onClick={() => runAction(groupKey, undoFgConfirm(groupKey))}
                                disabled={isPending(groupKey)}
                                className="font-sans text-[10.5px] font-semibold text-action-primary underline disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isPending(groupKey) ? "Membuka…" : "Buka kunci ↺"}
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => allRollsClosed && runAction(groupKey, confirmFgDone(groupKey, selectedMrpId, vendorId, g.warna, g.lengan))}
                              disabled={!allRollsClosed || isPending(groupKey)}
                              title={allRollsClosed ? undefined : "Tutup semua roll grup ini dulu (\"Lihat by size\" → Tutup Roll)"}
                              className={
                                "flex-none rounded-md px-2.5 py-[5px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed " +
                                (allRollsClosed ? "bg-action-primary" + (isPending(groupKey) ? " opacity-50" : "") : "bg-[#B8C2CC]")
                              }
                            >
                              {isPending(groupKey) ? "Menyimpan…" : "Selesai Produksi"}
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
                          <div className="grid grid-cols-4 gap-x-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            <span>Size</span>
                            <span className="text-right">Reject (otomatis)</span>
                            <span className="text-right">Rework</span>
                            <span className="text-right">Sisa reject</span>
                          </div>
                          {(() => {
                            const grossPerSize = rejectGrossForGroup(groupKey, productionResults);
                            const reworkPerSize = reworkedAwayBySize(groupKey, productionResults);
                            const rejectSizes = sizes.filter((size) => (grossPerSize[size] ?? 0) > 0 || (reworkPerSize[size] ?? 0) > 0);
                            if (rejectSizes.length === 0) {
                              return <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Tidak ada reject — finish good sudah mencapai target.</div>;
                            }
                            return rejectSizes.map((size) => (
                              <div key={size} className="grid grid-cols-4 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
                                <span className="font-mono font-medium">{size}</span>
                                <span className="text-right font-mono">{grossPerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-success-fg">{reworkPerSize[size] ?? 0}</span>
                                <span className="text-right font-mono text-danger-fg">{recorded[size] ?? 0}</span>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                    {expanded && !isFgConfirmed && kind === "FG" && (
                      <div className="border-b border-[#CFE0EF] bg-info-bg p-4">
                        <div className="mb-2.5 font-sans text-[11px] leading-[1.5] text-info-fg">
                          Revisi 2026-09-07: Finish Good sekarang dicatat PER ROLL (bukan lagi total bebas per warna/lengan) — supaya HPP bisa ditelusuri sampai ke
                          roll bahan baku yang tepat. Isi qty FG aktual tiap roll (default = hasil cutting roll itu sendiri), lalu <b>Tutup Roll</b> begitu final.
                          &quot;Selesai Produksi&quot; grup ini baru aktif setelah SEMUA roll ditutup.
                        </div>
                        {groupBatches.length === 0 && (
                          <div className="rounded-md border border-[#CFE0EF] bg-white px-3 py-3 text-center font-sans text-[11.5px] text-text-muted">
                            Belum ada roll tercutting untuk grup ini.
                          </div>
                        )}
                        <div className="flex flex-col gap-3">
                          {groupBatches.map((b) => {
                            const rollTarget = b.sizeQty ?? {};
                            const isClosed = !!b.closedAt;
                            const draft = fgSizeDraft[b.id] ?? rollTarget;
                            const totalTarget = Object.values(rollTarget).reduce((a, c) => a + c, 0);
                            const totalDraft = Object.values(draft).reduce((a, c) => a + (c || 0), 0);
                            // Item revisi 2026-09-08 (owner: "tampilan UI-nya sangat tidak presisi
                            // dan buruk dilihat" -- perbaiki lagi): `grid-cols-3` dulu MEREGANGKAN
                            // tiap pasangan size+qty ke 1/3 lebar baris berapa pun jumlah size-nya
                            // (2 size = 2 kolom terisi + 1 kosong, jarak label↔input jadi lebar &
                            // tidak presisi). Diganti `flex flex-wrap` dengan tiap size jadi CHIP
                            // sendiri (label+input menempel rapat, lebar mengikuti konten) — sejajar
                            // rapi berapa pun jumlah size-nya, sama pola dengan modal Input Hasil
                            // Cutting (production-cutting-tab.tsx).
                            return (
                              <div key={b.id} className="overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF1F4] bg-[#F7F9FB] px-3 py-2">
                                  <span className="font-sans text-[11.5px] font-medium text-[#31414F]">
                                    Roll <span className="font-mono">{b.codeRoll || b.id}</span>{" "}
                                    <span className="font-mono text-[10.5px] text-text-muted">({totalTarget} pcs hasil cutting)</span>
                                  </span>
                                  {isClosed ? (
                                    <StatusPill tone="success">Roll ditutup</StatusPill>
                                  ) : (
                                    <Button onClick={() => runAction(b.id, closeProductionBatch(b.id, draft))} disabled={isPending(b.id)} variant="primary" size="xs">
                                      {isPending(b.id) ? "Menutup…" : `Tutup Roll (${totalDraft})`}
                                    </Button>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-3 px-3 py-2.5">
                                  {Object.keys(rollTarget).length === 0 && (
                                    <span className="font-sans text-[11px] text-text-muted">Roll ini belum punya hasil cutting.</span>
                                  )}
                                  {Object.entries(rollTarget).map(([size, tQty]) => (
                                    <div key={size} className="flex flex-col">
                                      <span className="whitespace-nowrap font-sans text-[10px] font-medium text-text-muted">{size}</span>
                                      {isClosed ? (
                                        <span className="mt-1 font-mono text-[11.5px] font-medium text-[#31414F]">
                                          {b.fgSizeQty?.[size] ?? 0} <span className="text-text-muted">/ {tQty}</span>
                                        </span>
                                      ) : (
                                        <NumberInput
                                          value={draft[size] ?? tQty}
                                          decimals={0}
                                          onChange={(v) => setFgSizeDraft((prev) => ({ ...prev, [b.id]: { ...(prev[b.id] ?? rollTarget), [size]: v } }))}
                                          className="input mt-1 w-[92px] text-right"
                                        />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
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
                    ? "minmax(90px,0.7fr) minmax(120px,0.9fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(110px,0.8fr) minmax(160px,1.5fr) minmax(90px,0.7fr)"
                    : "minmax(100px,0.9fr) minmax(120px,1fr) minmax(220px,1.6fr) minmax(90px,0.7fr)",
              }}
            >
              <span>No MRP</span>
              <span>No PO Produksi</span>
              {kind === "REJECT" ? (
                <>
                  <span className="text-right">Qty reject</span>
                  <span className="text-right">Qty rework</span>
                  <span className="text-right">Qty sisa reject</span>
                  <span>Remark sisa reject</span>
                </>
              ) : (
                <span>Progres FG</span>
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
              const qtySisaReject = total; // net (gross - rework) — sama dengan total sizeQty semua entri REJECT PO ini.
              // Item 17: denominator progres FG = total hasil cutting AKTUAL (cuttingSizesForGroup,
              // sudah termasuk grup tujuan rework lintas lengan lewat warnaLenganGroupsWithFg) dari
              // SEMUA warna/lengan mrpId row ini, bukan cuma yang tercatat di PO ini saja.
              const fgTargetPo =
                kind === "FG"
                  ? warnaLenganGroupsWithFg(mrpId, vendorId, productionBatches, productionResults).reduce(
                      (sum, g) => sum + Object.values(cuttingSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, productionBatches)).reduce((a, b) => a + b, 0),
                      0
                    )
                  : 0;
              const fgPct = fgTargetPo > 0 ? Math.min(100, Math.round((total / fgTargetPo) * 100)) : 0;
              const fgTone = fgTargetPo > 0 && total > fgTargetPo ? "over" : fgPct >= 100 ? "done" : "active";
              return (
                <div key={poId}>
                  <div
                    className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]"
                    style={{
                      gridTemplateColumns:
                        kind === "REJECT"
                          ? "minmax(90px,0.7fr) minmax(120px,0.9fr) minmax(90px,0.7fr) minmax(90px,0.7fr) minmax(110px,0.8fr) minmax(160px,1.5fr) minmax(90px,0.7fr)"
                          : "minmax(100px,0.9fr) minmax(120px,1fr) minmax(220px,1.6fr) minmax(90px,0.7fr)",
                    }}
                  >
                    <span className="font-mono">{mrpId}</span>
                    <span className="font-mono font-medium">{poId}</span>
                    {kind === "REJECT" ? (
                      <>
                        <span className="text-right font-mono">{qtyRejectGross}</span>
                        <span className="text-right font-mono">{qtyRework}</span>
                        <span className="text-right font-mono text-danger-fg">{qtySisaReject}</span>
                        <input
                          value={rejectRemarks[poId] ?? ""}
                          onChange={(e) => setRejectRemark(poId, e.target.value)}
                          placeholder="Catatan sisa reject…"
                          className="input text-[11.5px]"
                        />
                      </>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-mono">
                          {total} / {fgTargetPo} pcs
                        </span>
                        <ProgressBar pct={Math.min(100, fgPct)} tone={fgTone} className="w-[80px]" />
                        <span className="font-mono text-[10.5px] text-text-muted">{fgPct}%</span>
                      </span>
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
