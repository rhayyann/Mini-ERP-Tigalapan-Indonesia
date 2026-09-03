"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import {
  availableCodeRollsForColor,
  availableRollsByAduanRow,
  formatDateTime,
  formatDecimal,
  formatDuration,
  materialClaimStage,
  materialReceivedForMaklon,
  pendingWeighRolls,
  restingMinutes,
  targetSizesForBatch,
  weightVariance,
  YIELD_ALERT_THRESHOLD_PCT,
  type MaterialClaimStage,
  type PendingWeighRoll,
} from "@/lib/mrp/derive";
import { RESTING_TARGET_MINUTES } from "@/lib/mrp/seed";
import type { AduanPolaRow, Lengan } from "@/lib/mrp/types";

function nowLocalDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Konversi nilai naive dari <input type="datetime-local"> (mis. "2026-09-03T12:33", TANPA info
 *  zona waktu) jadi ISO UTC yang benar sebelum dikirim ke server. `new Date(str)` menafsirkan
 *  string tanpa zona sebagai jam LOKAL browser -- kalau string mentahnya (bukan hasil konversi
 *  ini) langsung dikirim & disimpan ke kolom timestamptz, Postgres/Supabase menafsirkannya
 *  sebagai UTC, jadi begitu ditampilkan lagi (dikonversi balik ke lokal) jamnya geser sebesar
 *  offset zona waktu (mis. +8 jam kalau browser di GMT+8) -- itu penyebab CUTTING sempat
 *  tampil "20.33" padahal yang diketik "12.33". Dipakai untuk restingAt/cuttingAt, satu-satunya
 *  field di tab ini yang genuinely timestamptz (lihat migration 0010) & diisi lewat input jenis
 *  ini -- field lain (today()/nowIso() di server) tidak lewat jalur browser-local ini. */
function toUtcIso(localDatetimeValue: string): string {
  return new Date(localDatetimeValue).toISOString();
}

type AduanGroup = { kode: string; lengan: Lengan; rows: (AduanPolaRow & { available: number })[]; totalQty: number; totalAvailable: number };
type CuttingLine = { id: string; warna: string; codeRoll: string; gramasi: number };

// Kolom "Material dalam produksi" -- MRP | Kode | Warna/lengan | Code roll | Roll | Gramasi |
// Resting | Cutting | Durasi Resting | Status Resting | Hasil Aduan/Yield. "Status Resting"
// (badge "RESTING KURANG DARI TARGET") sekarang kolom TERSENDIRI, tidak lagi digabung dengan
// "Durasi Resting" -- sebelumnya keduanya di satu sel bikin badge menabrak kolom sebelahnya.
const CUTTING_BATCH_COLUMNS =
  "minmax(85px,0.5fr) minmax(75px,0.4fr) minmax(150px,1fr) minmax(130px,0.8fr) minmax(60px,0.4fr) minmax(90px,0.5fr) minmax(160px,1fr) minmax(190px,1.1fr) minmax(110px,0.6fr) minmax(160px,0.9fr) minmax(230px,1.4fr)";

export function ProductionCuttingTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const startProductionBatch = useMrpStore((s) => s.startProductionBatch);
  const updateBatchToCutting = useMrpStore((s) => s.updateBatchToCutting);
  const receiveRawMaterialRoll = useMrpStore((s) => s.receiveRawMaterialRoll);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  const confirmMaterialClaimReturReceived = useMrpStore((s) => s.confirmMaterialClaimReturReceived);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [lines, setLines] = useState<CuttingLine[]>([]);
  const [restingAt, setRestingAt] = useState(nowLocalDatetime());
  // Dulu restingAt di-set "now" sekali saat grup dipilih (pickGroup) lalu dipakai apa adanya saat
  // submit — kalau user butuh waktu lama isi code roll/gramasi sebelum klik "Resting", "Durasi
  // Resting" di tabel bawah langsung tampak sudah berjalan sejak form dibuka, bukan sejak roll
  // BENAR-BENAR mulai resting. Sekarang: kalau user tidak pernah sentuh field tanggal/jam ini
  // secara manual, nilainya di-refresh ke waktu saat ini persis sebelum submit (lihat
  // submitResting) — field tetap bisa diedit manual untuk backdate yang memang disengaja.
  const [restingAtTouched, setRestingAtTouched] = useState(false);
  const [cuttingDraft, setCuttingDraft] = useState<Record<string, string>>({});
  // Hasil aduan AKTUAL per roll (qty per size), diinput bareng datetime saat "Update ke Cutting"
  // — dulu tidak ada tempat mencatat ini sama sekali, cutting output cuma diestimasi dari rasio
  // rencana MRP (lihat cuttingSizesForGroup di derive.ts).
  const [cuttingSizeDraft, setCuttingSizeDraft] = useState<Record<string, Record<string, number>>>({});
  // Input "Hasil aduan" (datetime cutting + qty per size) sekarang popup, bukan baris expand
  // inline -- cuma SATU batch yang bisa diisi dalam satu waktu, ditentukan oleh id ini.
  const [activeCuttingBatchId, setActiveCuttingBatchId] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Timbang roll — dulu ada di Good Receive (vendor timbang begitu roll fisik datang), sekarang
  // dipindah ke sini: roll yang sudah ditandai diterima di Good Receive tapi belum ditimbang (atau
  // masih di luar toleransi & perlu ditimbang ulang) baru bisa dipilih untuk Resting setelah
  // ditimbang & sesuai di sini (lihat availableCodeRollsForColor/availableRollsForAduanRow).
  const [weighDraft, setWeighDraft] = useState<Record<string, number>>({});
  // Code roll pengganti -- cuma relevan/dipakai untuk roll yang lagi ditimbang ulang setelah
  // retur (lihat rowClaim.unlockedForReweigh di bawah), karena roll fisik penggantinya bisa saja
  // punya code roll berbeda dari roll lama yang diklaim.
  const [codeRollDraft, setCodeRollDraft] = useState<Record<string, string>>({});
  const [pendingClaim, setPendingClaim] = useState<{ key: string; roll: PendingWeighRoll; netKg: number; diffKg: number; pct: number } | null>(null);
  // Pesan error dari receiveRawMaterialRoll -- SEHARUSNYA jarang muncul karena tombol Simpan
  // sudah disembunyikan/nonaktif untuk roll yang masih terkunci klaim, tapi server tetap menolak
  // (lihat receiveRawMaterialRollAction) sebagai jaring pengaman kalau ada race condition/data
  // basi di layar (mis. dua tab terbuka bersamaan).
  const [weighError, setWeighError] = useState<string | null>(null);

  const activeStages: string[] = ["PARTIAL_WAITING_MATERIAL", "FULL_WAITING_MATERIAL", "PRODUCTION", "PARTIAL_PRODUCTION"];
  const readyMrpIds = maklonPOs
    .filter((p) => p.vendorProduksi === vendorId && p.approved && activeStages.includes(p.status) && materialReceivedForMaklon(p.mrpId, vendorId, invoices))
    .map((p) => p.mrpId);
  const readyMrps = mrpDetails.filter((d) => readyMrpIds.includes(d.mrp.id));

  const selectedDetail = mrpDetails.find((d) => d.mrp.id === selectedMrpId);
  const aduanRows = (selectedDetail?.aduanRows ?? []).filter((a) => a.vendor === vendorId);

  const weighRows = selectedMrpId ? pendingWeighRolls(selectedMrpId, vendorId, invoices, productionBatches) : [];
  function weighKey(r: PendingWeighRoll): string {
    return `${r.invoiceId}|${r.warna}|${r.lengan}|${r.rollIndex}`;
  }
  async function commitWeigh(r: PendingWeighRoll, netKg: number, claim?: { diffKg: number; pct: number }) {
    const key = weighKey(r);
    setWeighError(null);
    try {
      await receiveRawMaterialRoll(r.invoiceId, r.warna, r.lengan, r.rollIndex, netKg, claim, codeRollDraft[key]);
      setWeighDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setCodeRollDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      setWeighError(e instanceof Error ? e.message : "Gagal menyimpan hasil timbang.");
    }
  }
  function saveWeigh(r: PendingWeighRoll) {
    const key = weighKey(r);
    const netKg = weighDraft[key] ?? r.netKg ?? r.grossKg;
    const variance = weightVariance(r.grossKg, netKg);
    if (!variance.withinTolerance) {
      setPendingClaim({ key, roll: r, netKg, diffKg: variance.diff, pct: variance.pct });
      return;
    }
    commitWeigh(r, netKg);
  }

  // Dihitung SEKALIGUS untuk semua baris (bukan per-baris independen) -- baris dengan
  // warna+lengan sama berbagi satu pool roll fisik, lihat catatan di availableRollsByAduanRow.
  const availableByRow = selectedMrpId ? availableRollsByAduanRow(aduanRows, invoices, productionBatches, selectedMrpId) : {};
  const groups = new Map<string, AduanGroup>();
  for (const row of aduanRows) {
    const available = availableByRow[row.id] ?? 0;
    const key = row.kode + "|" + row.lengan;
    const g = groups.get(key) ?? { kode: row.kode, lengan: row.lengan, rows: [], totalQty: 0, totalAvailable: 0 };
    g.rows.push({ ...row, available });
    g.totalQty += row.qtyRoll;
    g.totalAvailable += available;
    groups.set(key, g);
  }
  const groupList = Array.from(groups.values());
  const selectedGroup = groups.get(selectedGroupKey) ?? null;

  function pickMrp(mrpId: string) {
    setSelectedMrpId(mrpId);
    setSelectedGroupKey("");
    setLines([]);
    setSubmitNotice(null);
  }

  function pickGroup(key: string) {
    setSelectedGroupKey(key);
    const g = groups.get(key);
    setRestingAt(nowLocalDatetime());
    setRestingAtTouched(false);
    setLines([{ id: "line-" + Date.now(), warna: g?.rows[0]?.warna ?? "", codeRoll: "", gramasi: 0 }]);
    setSubmitNotice(null);
  }

  function addLine() {
    // Tiap baris = 1 roll (qtyRoll di-hardcode 1 saat submit) — jangan biarkan user menambah
    // baris melebihi jumlah roll yang benar-benar tersedia untuk aduan pola ini, supaya tidak
    // ada baris "hantu" tanpa code roll yang bisa dipilih (dropdown-nya pasti kosong).
    if (selectedGroup && lines.length >= selectedGroup.totalAvailable) return;
    setLines((prev) => [...prev, { id: "line-" + Date.now() + "-" + prev.length, warna: selectedGroup?.rows[0]?.warna ?? "", codeRoll: "", gramasi: 0 }]);
  }

  function updateLine(id: string, patch: Partial<CuttingLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function codeOptionsFor(warna: string, excludeLineId: string): string[] {
    if (!selectedGroup) return [];
    const all = availableCodeRollsForColor(selectedMrpId, warna, selectedGroup.lengan, vendorId, invoices, productionBatches);
    const pickedElsewhere = new Set(lines.filter((l) => l.id !== excludeLineId).map((l) => l.codeRoll).filter(Boolean));
    return all.filter((c) => !pickedElsewhere.has(c));
  }

  async function submitResting() {
    if (!selectedGroup || submitting) return;
    // Dulu baris yang belum lengkap (mis. belum pilih code roll) di-skip DIAM-DIAM lalu semua
    // baris (termasuk yang di-skip) langsung dihapus dari layar — user tidak sadar sebagian
    // rollnya gagal tersimpan, cuma tahu belakangan dari "Total Roll Tersedia" yang ternyata
    // masih sisa. Sekarang: baris yang berhasil disimpan dihapus, baris yang belum lengkap
    // TETAP tampil supaya user bisa lengkapi & submit ulang.
    //
    // CATATAN: dulu startProductionBatch dipanggil tanpa `await` di dalam loop ini -- form
    // langsung ditutup/dikosongkan sebelum panggilan-panggilan itu (dan refresh snapshot
    // sesudahnya) benar-benar selesai, jadi tabel "Material dalam produksi" sempat tampak
    // tidak berubah/kosong sampai halaman di-reload manual, padahal batch-nya sudah tersimpan
    // di database (lihat catatan serupa di paying-voucher-wizard.tsx). Sekarang di-await satu
    // per satu supaya UI baru dianggap selesai setelah semuanya benar-benar tersimpan.
    setSubmitting(true);
    // Kalau user tidak pernah sentuh field tanggal/jam resting secara manual, refresh ke waktu
    // SEKARANG persis sebelum disimpan — bukan waktu saat grup pertama kali dipilih tadi, yang
    // bisa saja sudah berselang cukup lama karena user lagi isi code roll/gramasi.
    const effectiveRestingAt = restingAtTouched ? restingAt : nowLocalDatetime();
    const remaining: CuttingLine[] = [];
    let savedCount = 0;
    try {
      for (const line of lines) {
        if (!line.warna || !line.codeRoll) {
          remaining.push(line);
          continue;
        }
        const row = selectedGroup.rows.find((r) => r.warna === line.warna);
        if (!row) {
          remaining.push(line);
          continue;
        }
        await startProductionBatch({ mrpId: selectedMrpId, aduanRowId: row.id, qtyRoll: 1, gramasi: line.gramasi, restingAt: toUtcIso(effectiveRestingAt), codeRoll: line.codeRoll });
        savedCount++;
      }
    } finally {
      setSubmitting(false);
    }
    setSubmitNotice(
      remaining.length > 0
        ? `${savedCount} roll berhasil di-resting. ${remaining.length} baris belum lengkap (pilih code roll dulu) — belum tersimpan.`
        : null
    );
    setLines(remaining);
    if (remaining.length === 0) setSelectedGroupKey("");
  }

  const myBatches = productionBatches.filter((b) => b.vendorProduksi === vendorId);
  const canSubmit = lines.some((l) => l.warna && l.codeRoll);

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Mulai Produksi — pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => pickMrp(e.target.value)}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {readyMrps.map((d) => (
            <option key={d.mrp.id} value={d.mrp.id}>
              {d.mrp.id}
            </option>
          ))}
        </select>
        {readyMrps.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP dengan bahan siap dan pekerjaan belum selesai.</div>}
      </div>

      {selectedMrpId && weighRows.length > 0 && (
        <div className="w-full overflow-x-auto rounded-lg border border-[#F0DFC2] bg-warning-bg">
          <div className="border-b border-[#F0DFC2] px-4 py-3 font-sans text-[13px] font-semibold text-warning-fg">
            Timbang roll — {weighRows.length} roll perlu ditimbang atau dikonfirmasi ulang
          </div>
          <div className="border-b border-[#F0DFC2] bg-white/60 px-4 py-2 font-sans text-[11px] leading-[1.5] text-warning-fg">
            Roll yang sudah disimpan TETAP muncul di sini (bisa diedit lagi) selama belum dipilih code roll-nya di Aduan Pola &amp; di-submit Resting — kalau salah timbang, tinggal koreksi angkanya lalu Simpan lagi. Roll yang selisih beratnya di luar toleransi TERKUNCI (tidak bisa ditimbang ulang) sampai proses retur ke Procurement selesai.
          </div>
          {weighError && (
            <div className="border-b border-[#F0DFC2] bg-danger-bg px-4 py-2 font-sans text-[11px] leading-[1.5] text-danger-fg">{weighError}</div>
          )}
          <div
            className="grid min-w-[900px] gap-x-3 border-b border-[#F0DFC2] bg-white/40 px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
            style={{ gridTemplateColumns: "minmax(140px,1.1fr) minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.8fr) minmax(110px,0.9fr)" }}
          >
            <span>Warna / lengan</span>
            <span>Roll</span>
            <span>Code Roll</span>
            <span className="text-right">Berat kotor (kg)</span>
            <span className="text-right">Berat bersih (kg)</span>
            <span className="text-right">Selisih</span>
            <span>Toleransi</span>
            <span>Aksi</span>
          </div>
          {weighRows.map((r) => {
            const key = weighKey(r);
            const netVal = weighDraft[key] ?? r.netKg ?? r.grossKg;
            const variance = weightVariance(r.grossKg, netVal);
            // Status klaim SAAT INI dihitung dari r.netKg yang SUDAH TERSIMPAN (bukan dari draft
            // input yang belum disimpan) -- ini yang menentukan terkunci/tidaknya roll ini,
            // sinkron persis dengan pengecekan yang sama di receiveRawMaterialRollAction.
            const savedVariance = r.netKg !== undefined ? weightVariance(r.grossKg, r.netKg) : null;
            const stage: MaterialClaimStage = materialClaimStage(
              key,
              materialClaimResolutions,
              materialClaimReturRequests,
              materialClaimReturDeliveries,
              materialClaimReturReceipts
            );
            const hasActiveClaim = !!savedVariance && !savedVariance.withinTolerance && stage !== "SELESAI";
            const locked = hasActiveClaim && stage !== "RETUR_DITERIMA";
            const unlockedForReweigh = hasActiveClaim && stage === "RETUR_DITERIMA";
            const delivery = materialClaimReturDeliveries[key];
            const stageBanner: Record<Exclude<MaterialClaimStage, "SELESAI">, { tone: string; text: string }> = {
              BELUM: {
                tone: "bg-danger-bg text-danger-fg",
                text: "Selisih berat di luar toleransi — sudah dikirim ke Procurement (lihat Klaim Material). Roll ini TERKUNCI, tidak bisa ditimbang ulang sampai Procurement atur retur & kirim roll pengganti.",
              },
              RETUR_DIMINTA: {
                tone: "bg-info-bg text-info-fg",
                text: "Retur sudah diminta Procurement ke supplier — menunggu roll pengganti dikirim. Masih terkunci.",
              },
              RETUR_DIKIRIM: {
                tone: "bg-info-bg text-info-fg",
                text: `Roll pengganti sudah dikirim Procurement${delivery?.note ? ` (${delivery.note})` : ""} — sudah diterima fisik?`,
              },
              RETUR_DITERIMA: {
                tone: "bg-success-bg text-success-fg",
                text: "Roll pengganti sudah dikonfirmasi diterima — silakan timbang & ganti code roll di bawah kalau perlu, lalu Simpan.",
              },
            };
            return (
              <div key={key} className="border-b border-[#F0DFC2] last:border-b-0">
                {stage !== "SELESAI" && hasActiveClaim && (
                  <div className={"flex items-center justify-between gap-2 px-4 py-2 " + stageBanner[stage].tone}>
                    <span className="font-sans text-[11px]">{stageBanner[stage].text}</span>
                    {stage === "RETUR_DIKIRIM" && (
                      <Button onClick={() => confirmMaterialClaimReturReceived(key)} variant="primary" size="xs">
                        Tandai Diterima
                      </Button>
                    )}
                  </div>
                )}
                <div
                  className="grid min-w-[900px] items-center gap-x-3 bg-white px-4 py-[11px] font-sans text-xs text-[#31414F]"
                  style={{ gridTemplateColumns: "minmax(140px,1.1fr) minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.8fr) minmax(110px,0.9fr)" }}
                >
                  <span>
                    {r.warna} · {r.lengan}
                    {locked && <span className="ml-1.5 font-mono text-[10px] text-danger-fg">(terkunci — menunggu retur)</span>}
                    {unlockedForReweigh && <span className="ml-1.5 font-mono text-[10px] text-success-fg">(roll pengganti — timbang ulang)</span>}
                    {!hasActiveClaim && r.netKg !== undefined && (
                      <span className="ml-1.5 font-mono text-[10px] text-text-muted">(sudah ditimbang — bisa diedit)</span>
                    )}
                  </span>
                  <span className="font-mono font-medium">Roll {r.rollIndex + 1}</span>
                  {unlockedForReweigh ? (
                    <input
                      value={codeRollDraft[key] ?? r.codeRoll ?? ""}
                      onChange={(e) => setCodeRollDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder="Code roll pengganti"
                      className="rounded-md border border-[#DDE4EB] px-1.5 py-1 font-mono text-[11px]"
                    />
                  ) : (
                    <span className="font-mono text-[11px]">{r.codeRoll || "—"}</span>
                  )}
                  <span className="text-right font-mono">{formatDecimal(r.grossKg)}</span>
                  <span className="flex justify-end">
                    {locked ? (
                      <span className="w-[100px] text-right font-mono text-[#8A94A0]">{formatDecimal(netVal)}</span>
                    ) : (
                      <NumberInput value={netVal} decimals={2} onChange={(v) => setWeighDraft((prev) => ({ ...prev, [key]: v }))} className="input w-[100px] text-right" />
                    )}
                  </span>
                  <span className={"text-right font-mono " + (variance.withinTolerance ? "text-success-fg" : "text-danger-fg")}>
                    {variance.diff >= 0 ? "+" : ""}
                    {formatDecimal(variance.diff)} kg ({variance.pct.toFixed(1)}%)
                  </span>
                  <span>
                    <StatusPill tone={variance.withinTolerance ? "success" : "danger"}>{variance.withinTolerance ? "SESUAI" : "DI LUAR TOLERANSI"}</StatusPill>
                  </span>
                  <span>
                    {locked ? (
                      <span className="font-sans text-[10.5px] font-semibold text-text-muted">🔒 Terkunci</span>
                    ) : (
                      <Button onClick={() => saveWeigh(r)} variant="primary" size="xs">
                        Simpan
                      </Button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedDetail && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Aduan pola — {selectedDetail.mrp.id}</div>
          <div className="grid grid-cols-4 gap-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Kode aduan / lengan</span>
            <span className="text-right">Total qty roll aduan</span>
            <span className="text-right">Total roll tersedia</span>
            <span />
          </div>
          {groupList.map((g) => {
            const key = g.kode + "|" + g.lengan;
            return (
              <div key={key} className="grid grid-cols-4 items-center gap-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono font-medium">
                  {g.kode} · {g.lengan}
                </span>
                <span className="text-right font-mono">{g.totalQty}</span>
                <span className={"text-right font-mono " + (g.totalAvailable > 0 ? "text-success-fg" : "text-text-muted")}>{g.totalAvailable}</span>
                <span className="text-right">
                  <button
                    onClick={() => pickGroup(key)}
                    disabled={g.totalAvailable <= 0}
                    className="font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Pilih
                  </button>
                </span>
              </div>
            );
          })}

          {selectedGroup && (
            <div className="border-t border-[#CFE0EF] bg-info-bg p-4">
              <div className="font-sans text-xs font-semibold text-info-fg">
                {selectedGroup.kode} · {selectedGroup.lengan} — pilih warna, code roll &amp; gramasi
              </div>

              <div className="mt-2.5 flex items-end gap-3">
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Tanggal &amp; jam resting</div>
                  <input
                    type="datetime-local"
                    value={restingAt}
                    onChange={(e) => {
                      setRestingAt(e.target.value);
                      setRestingAtTouched(true);
                    }}
                    className="input mt-1"
                  />
                </div>
                <button
                  onClick={addLine}
                  disabled={lines.length >= selectedGroup.totalAvailable}
                  title={lines.length >= selectedGroup.totalAvailable ? "Semua roll tersedia sudah ditambahkan" : undefined}
                  className="rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[8px] font-sans text-[11px] font-semibold text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add roll
                </button>
                <span className="font-sans text-[11px] text-text-muted">
                  {lines.length} / {selectedGroup.totalAvailable} roll tersedia
                </span>
              </div>

              <div className="mt-2.5 overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                <div className="grid grid-cols-4 gap-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna</span>
                  <span>Code roll</span>
                  <span className="text-right">Gramasi (gsm)</span>
                  <span className="text-right">Aksi</span>
                </div>
                {lines.map((line) => {
                  const codeOptions = codeOptionsFor(line.warna, line.id);
                  // Roll ini dihitung "tersedia" (qty-wise) tapi tidak ada code roll yang bisa
                  // dipilih — biasanya karena roll fisiknya diterima di Good Receive tanpa code
                  // roll diisi. Baris ini TIDAK BISA disubmit sampai code roll-nya dilengkapi
                  // (lihat submitResting) — beri tahu user secara eksplisit, jangan biarkan diam.
                  const noCodeAvailable = codeOptions.length === 0 && !line.codeRoll;
                  return (
                    <div key={line.id} className="border-t border-[#F1F4F7]">
                      <div className="grid grid-cols-4 items-center gap-2 px-3 py-1.5 font-sans text-xs text-[#31414F]">
                        <select
                          value={line.warna}
                          onChange={(e) => updateLine(line.id, { warna: e.target.value, codeRoll: "" })}
                          className="rounded-md border border-[#DDE4EB] px-1.5 py-1 font-sans text-[11.5px]"
                        >
                          {selectedGroup.rows.map((r) => (
                            <option key={r.warna} value={r.warna}>
                              {r.warna}
                            </option>
                          ))}
                        </select>
                        <select
                          value={line.codeRoll}
                          onChange={(e) => updateLine(line.id, { codeRoll: e.target.value })}
                          className={"rounded-md border px-1.5 py-1 font-sans text-[11.5px] " + (noCodeAvailable ? "border-danger" : "border-[#DDE4EB]")}
                        >
                          <option value="">— pilih code roll —</option>
                          {codeOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <span className="flex justify-end">
                          <NumberInput value={line.gramasi} onChange={(v) => updateLine(line.id, { gramasi: v })} decimals={0} className="input w-[90px] text-right" />
                        </span>
                        <span className="text-right">
                          <Button onClick={() => removeLine(line.id)} variant="danger" size="xs">
                            Hapus
                          </Button>
                        </span>
                      </div>
                      {noCodeAvailable && (
                        <div className="px-3 pb-1.5 font-sans text-[10.5px] text-danger-fg">
                          Belum ada code roll yang bisa dipilih untuk warna ini — kemungkinan roll diterima tanpa code roll di Good Receive, atau roll-nya masih berstatus klaim
                          selisih berat (di luar toleransi / retur diminta, belum ditimbang ulang sesuai) — cek halaman Klaim Material.
                        </div>
                      )}
                    </div>
                  );
                })}
                {lines.length === 0 && <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Belum ada baris — klik + Add roll.</div>}
              </div>
              {submitNotice && (
                <div className="mt-2.5 rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-warning-fg">{submitNotice}</div>
              )}

              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={submitResting}
                  disabled={!canSubmit || submitting}
                  className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Memproses..." : "Resting"}
                </button>
                <button onClick={() => setSelectedGroupKey("")} disabled={submitting} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-50">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Material dalam produksi</div>
        <div className="overflow-x-auto">
          <div>
            <div
              className="grid min-w-[1650px] gap-x-5 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{
                gridTemplateColumns: CUTTING_BATCH_COLUMNS,
              }}
            >
              <span>MRP</span>
              <span>Kode</span>
              <span>Warna / lengan</span>
              <span>Code roll</span>
              <span className="text-right">Roll</span>
              <span className="text-right">Gramasi</span>
              <span>Resting</span>
              <span>Cutting</span>
              <span>Durasi Resting</span>
              <span>Status Resting</span>
              <span>Hasil Aduan / Yield</span>
            </div>
            {myBatches.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada batch produksi.</div>}
            {myBatches.map((b) => {
              const durasiKurang = b.cuttingAt ? restingMinutes(b.restingAt, b.cuttingAt) < RESTING_TARGET_MINUTES : false;
              const detail = mrpDetails.find((d) => d.mrp.id === b.mrpId);
              const targetSizes = targetSizesForBatch(b, detail?.aduanRows ?? []);
              const targetTotal = Object.values(targetSizes).reduce((a, c) => a + c, 0);
              const actualTotal = b.sizeQty ? Object.values(b.sizeQty).reduce((a, c) => a + c, 0) : 0;
              const yieldPct = targetTotal > 0 && b.sizeQty ? (actualTotal / targetTotal) * 100 : null;
              const yieldAlert = yieldPct !== null && yieldPct < YIELD_ALERT_THRESHOLD_PCT;
              // Rincian per size (bukan cuma total qty) -- diminta supaya kelihatan size mana
              // yang hasilnya kurang, bukan cuma total gabungan yang bisa menyamarkan itu.
              const sizesForDetail = Array.from(new Set([...Object.keys(targetSizes), ...Object.keys(b.sizeQty ?? {})]));
              return (
                <div key={b.id} className="border-b border-[#F1F4F7] last:border-b-0">
                  <div className="grid min-w-[1650px] items-center gap-x-5 px-4 py-[11px] font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: CUTTING_BATCH_COLUMNS }}>
                    <span className="font-mono">{b.mrpId}</span>
                    <span className="font-mono font-medium">{b.kode}</span>
                    <span>
                      {b.warna} · {b.lengan}
                    </span>
                    <span className="font-mono text-[11px]">{b.codeRoll || "—"}</span>
                    <span className="text-right font-mono">{b.qtyRoll}</span>
                    <span className="text-right font-mono">{b.gramasi} gsm</span>
                    <span className="font-mono text-[11px]">{formatDateTime(b.restingAt)}</span>
                    <span className="font-mono text-[11px]">
                      {b.cuttingAt ? (
                        formatDateTime(b.cuttingAt)
                      ) : (
                        <Button
                          onClick={() => {
                            setCuttingDraft((prev) => ({ ...prev, [b.id]: prev[b.id] ?? nowLocalDatetime() }));
                            setCuttingSizeDraft((prev) => ({ ...prev, [b.id]: prev[b.id] ?? {} }));
                            setActiveCuttingBatchId(b.id);
                          }}
                          variant="primary"
                          size="xs"
                        >
                          Update ke Cutting →
                        </Button>
                      )}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{formatDuration(b.restingAt, b.cuttingAt ?? new Date().toISOString())}</span>
                    <span>{durasiKurang && <StatusPill tone="warning">RESTING KURANG DARI TARGET</StatusPill>}</span>
                    <span className="flex flex-col gap-0.5 font-mono text-[11px]">
                      {b.cuttingAt ? (
                        b.sizeQty ? (
                          <>
                            <span className="flex flex-wrap items-center gap-1">
                              <span>
                                {actualTotal} / {targetTotal} pcs
                              </span>
                              {yieldPct !== null && <StatusPill tone={yieldAlert ? "danger" : "success"}>{yieldPct.toFixed(1)}%</StatusPill>}
                            </span>
                            {sizesForDetail.length > 0 && (
                              <span className="text-[10px] text-text-muted">
                                {sizesForDetail.map((size) => `${size} ${b.sizeQty?.[size] ?? 0}/${targetSizes[size] ?? 0}`).join(" · ")}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-text-muted">— (belum diisi)</span>
                        )
                      ) : (
                        <span className="text-text-muted">Target: {targetTotal} pcs</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {activeCuttingBatchId &&
        (() => {
          const b = myBatches.find((batch) => batch.id === activeCuttingBatchId);
          if (!b || b.cuttingAt) return null;
          const draft = cuttingDraft[b.id] ?? nowLocalDatetime();
          const detail = mrpDetails.find((d) => d.mrp.id === b.mrpId);
          const targetSizes = targetSizesForBatch(b, detail?.aduanRows ?? []);
          const targetTotal = Object.values(targetSizes).reduce((a, c) => a + c, 0);
          const sizeDraft = cuttingSizeDraft[b.id] ?? {};
          const actualTotal = Object.values(sizeDraft).reduce((a, c) => a + c, 0);
          function closeModal() {
            setActiveCuttingBatchId(null);
            setCuttingDraft((prev) => {
              const next = { ...prev };
              delete next[b!.id];
              return next;
            });
            setCuttingSizeDraft((prev) => {
              const next = { ...prev };
              delete next[b!.id];
              return next;
            });
          }
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
              <div className="w-full max-w-[520px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
                <div className="border-b border-border-subtle px-5 py-3.5">
                  <span className="font-sans text-[13px] font-semibold text-text-primary">
                    Update ke Cutting — {b.warna} · {b.lengan} ({b.codeRoll || "roll " + b.qtyRoll})
                  </span>
                </div>
                <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Tanggal &amp; jam cutting</div>
                  <input
                    type="datetime-local"
                    value={draft}
                    onChange={(e) => setCuttingDraft((prev) => ({ ...prev, [b.id]: e.target.value }))}
                    className="input mt-1"
                  />

                  <div className="mt-3.5 font-sans text-[11px] font-semibold text-text-primary">Hasil aduan (target {targetTotal} pcs dari roll ini)</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.keys(targetSizes).length === 0 && (
                      <span className="font-sans text-[11px] text-text-muted">Aduan pola untuk roll ini tidak punya rincian size.</span>
                    )}
                    {Object.entries(targetSizes).map(([size, tgt]) => (
                      <div key={size} className="flex flex-col">
                        <span className="font-sans text-[10px] text-text-muted">
                          {size} <span className="text-[9px]">(target {tgt})</span>
                        </span>
                        <NumberInput
                          value={sizeDraft[size] ?? 0}
                          decimals={0}
                          onChange={(v) => setCuttingSizeDraft((prev) => ({ ...prev, [b.id]: { ...(prev[b.id] ?? {}), [size]: v } }))}
                          className="input mt-0.5 w-[86px] text-right"
                        />
                      </div>
                    ))}
                  </div>
                  {targetTotal > 0 && actualTotal > 0 && actualTotal / targetTotal < YIELD_ALERT_THRESHOLD_PCT / 100 && (
                    <div className="mt-2.5 font-sans text-[10.5px] text-danger-fg">
                      Yield {((actualTotal / targetTotal) * 100).toFixed(1)}% — di bawah baseline {YIELD_ALERT_THRESHOLD_PCT}%, akan masuk alert yield ke portal Produksi.
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
                  <button onClick={closeModal} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                    Batal
                  </button>
                  <Button
                    onClick={() => {
                      updateBatchToCutting(b.id, toUtcIso(draft), sizeDraft);
                      setActiveCuttingBatchId(null);
                      setCuttingDraft((prev) => {
                        const next = { ...prev };
                        delete next[b.id];
                        return next;
                      });
                      setCuttingSizeDraft((prev) => {
                        const next = { ...prev };
                        delete next[b.id];
                        return next;
                      });
                    }}
                    variant="success"
                    size="sm"
                  >
                    Simpan
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

      {pendingClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45">
          <div className="w-full max-w-[440px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-danger-bg bg-danger-bg px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-danger" />
                <span className="font-sans text-[13px] font-semibold text-danger-fg">Selisih berat di luar toleransi</span>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-sans text-xs text-[#31414F]">
                {pendingClaim.roll.warna} · {pendingClaim.roll.lengan} — Roll {pendingClaim.roll.rollIndex + 1} — selisih {pendingClaim.diffKg >= 0 ? "+" : ""}
                {formatDecimal(pendingClaim.diffKg)} kg ({pendingClaim.pct.toFixed(1)}%), melebihi toleransi ±2%.
              </div>
              <div className="mt-2 font-sans text-xs text-text-muted">Kirim claim ke Procurement supaya selisih ini dicatat dan bisa ditindaklanjuti?</div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button
                onClick={() => setPendingClaim(null)}
                className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  commitWeigh(pendingClaim.roll, pendingClaim.netKg, { diffKg: pendingClaim.diffKg, pct: pendingClaim.pct });
                  setPendingClaim(null);
                }}
                className="rounded-md bg-danger px-3.5 py-[7px] font-sans text-xs font-semibold text-white"
              >
                Ya, Kirim Claim
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
