"use client";

import { useRef, useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import {
  availableCodeRollsForColor,
  availableRollsByAduanRow,
  confirmedWeighedRolls,
  formatDateTime,
  formatDecimal,
  formatDuration,
  materialClaimStage,
  materialReceivedForMaklon,
  pendingWeighRolls,
  restingMinutes,
  restingSessionGroups,
  targetSizesForBatch,
  weighedUnconfirmedRolls,
  weightVariance,
  YIELD_ALERT_THRESHOLD_PCT,
  type MaterialClaimStage,
  type PendingWeighRoll,
} from "@/lib/mrp/derive";
import { countCuttingAwaitingUpdateForMrp, pendingMarker } from "@/lib/shell/badges";
import { RESTING_TARGET_MINUTES } from "@/lib/mrp/seed";
import type { AduanPolaRow, Lengan, ProductionBatch } from "@/lib/mrp/types";

/** Item 3.2 (feedback batch 2026-09-04): kompres foto bukti berat bersih di BROWSER sebelum
 *  dikirim ke Server Action (limit body 1 MB default Next.js, lihat next.config.ts) -- resize ke
 *  sisi terpanjang maks 1280px, JPEG quality 0.7. Dikembalikan sebagai data-URI (sama pola
 *  penyimpanan seperti buktiPvDataUrl di PV, lihat types.ts) supaya tidak butuh Supabase Storage. */
async function compressImageToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file foto."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Gagal membaca gambar."));
    el.src = raw;
  });
  const MAX_EDGE = 1280;
  let { width, height } = img;
  if (width > MAX_EDGE || height > MAX_EDGE) {
    if (width >= height) {
      height = Math.round((height / width) * MAX_EDGE);
      width = MAX_EDGE;
    } else {
      width = Math.round((width / height) * MAX_EDGE);
      height = MAX_EDGE;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung kompresi foto (canvas).");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const MAX_CLAIM_PHOTO_BYTES = 700 * 1024;

function dataUrlApproxBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.round(b64.length * 0.75);
}

/** Item 16 (Decided OQ3: per roll, grouped under warna headings) -- batch "butuh Input Hasil
 *  Cutting" kalau belum pernah dicutting SAMA SEKALI, ATAU sudah dicutting tapi hasil aduannya
 *  masih kosong/nol semua (item 18.3 "Perbaiki Hasil Cutting"). Batch yang sudah lengkap TIDAK
 *  butuh aksi lagi -- tidak ikut modal grup. */
function batchNeedsCuttingInput(b: ProductionBatch): boolean {
  if (!b.cuttingAt) return true;
  if (!b.sizeQty || Object.keys(b.sizeQty).length === 0) return true;
  return Object.values(b.sizeQty).every((v) => !v || v <= 0);
}

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

// Kolom baris GRUP "Material dalam produksi" -- MRP | Kode·lengan | Part | Warna | Roll | Resting |
// Cutting | Durasi Resting | Status Resting | Hasil Aduan/Yield | expander. Item 5 (feedback
// batch 2026-09-05): sebelumnya 1 baris = 1 ROLL (Code roll & Gramasi ada di kolom ini) --
// sekarang 1 baris = 1 SESI RESTING ("Part", lihat restingSessionGroups di lib/mrp/derive.ts),
// Code roll & Gramasi pindah ke sub-tabel per-roll (CUTTING_BATCH_COLUMNS di bawah) karena
// keduanya spesifik per roll, bukan per sesi. "Status Resting" (badge "RESTING KURANG DARI
// TARGET") tetap kolom TERSENDIRI, tidak digabung dengan "Durasi Resting".
const CUTTING_SESSION_COLUMNS =
  "minmax(85px,0.5fr) minmax(140px,0.8fr) minmax(90px,0.5fr) minmax(150px,0.9fr) minmax(60px,0.4fr) minmax(160px,1fr) minmax(190px,1.1fr) minmax(110px,0.6fr) minmax(160px,0.9fr) minmax(230px,1.4fr) minmax(110px,0.6fr)";

// Kolom sub-tabel PER ROLL (ditampilkan begitu 1 baris grup di atas di-expand) -- Warna | Code
// roll | Gramasi | Cutting | Hasil Aduan/Yield.
const CUTTING_BATCH_COLUMNS = "minmax(150px,1fr) minmax(130px,0.8fr) minmax(90px,0.5fr) minmax(160px,1fr) minmax(230px,1.4fr)";

export function ProductionCuttingTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const startProductionBatch = useMrpStore((s) => s.startProductionBatch);
  const updateBatchToCutting = useMrpStore((s) => s.updateBatchToCutting);
  const receiveRawMaterialRoll = useMrpStore((s) => s.receiveRawMaterialRoll);
  const confirmRollWeigh = useMrpStore((s) => s.confirmRollWeigh);
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
  // Hasil aduan AKTUAL per roll (qty per size), diinput bareng datetime saat "Input Hasil Cutting"
  // — dulu tidak ada tempat mencatat ini sama sekali, cutting output cuma diestimasi dari rasio
  // rencana MRP (lihat cuttingSizesForGroup di derive.ts). Item 16: keyed per batch id, TAPI
  // modalnya sekarang scoped ke satu GRUP aduan/pola sekaligus (lihat activeCuttingGroupKey).
  const [cuttingSizeDraft, setCuttingSizeDraft] = useState<Record<string, Record<string, number>>>({});
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
  // Item 14.1: "Simpan semua" per grup warna·lengan queue-kan roll yang claimable (perlu foto
  // bukti, tidak bisa diotomatisasi) SATU PER SATU ke sini -- dialog claim selalu menampilkan
  // claimQueue[0], begitu diproses (submit ATAU batal) baris itu di-pop, dialog lanjut ke
  // berikutnya kalau masih ada.
  const [claimQueue, setClaimQueue] = useState<{ key: string; roll: PendingWeighRoll; netKg: number; diffKg: number; pct: number }[]>([]);
  const pendingClaim = claimQueue[0] ?? null;
  // Item 3: foto bukti berat bersih -- WAJIB sebelum "Ya, Kirim Claim" bisa diklik.
  const [claimPhotoDataUrl, setClaimPhotoDataUrl] = useState<string | null>(null);
  const [claimPhotoFileName, setClaimPhotoFileName] = useState<string | undefined>(undefined);
  // Item 4 round-2 (Tester cosmetic note): ref ke <input type="file"> supaya "Ganti foto" bisa
  // ikut mengosongkan value DOM-nya, bukan cuma state React -- tanpa ini, memilih file YANG SAMA
  // lagi setelah "Ganti foto" tidak memicu onChange sama sekali (browser anggap value tidak berubah).
  const claimPhotoInputRef = useRef<HTMLInputElement>(null);
  const [claimPhotoError, setClaimPhotoError] = useState<string | null>(null);
  const [claimPhotoBusy, setClaimPhotoBusy] = useState(false);
  // Pesan error dari receiveRawMaterialRoll -- SEHARUSNYA jarang muncul karena tombol Simpan
  // sudah disembunyikan/nonaktif untuk roll yang masih terkunci klaim, tapi server tetap menolak
  // (lihat receiveRawMaterialRollAction) sebagai jaring pengaman kalau ada race condition/data
  // basi di layar (mis. dua tab terbuka bersamaan).
  const [weighError, setWeighError] = useState<string | null>(null);
  // Item 4.5: catatan non-blocking begitu roll over-weight (di luar toleransi TAPI lebih BERAT,
  // bukan klaim) disimpan langsung.
  const [overWeightNotice, setOverWeightNotice] = useState<string | null>(null);
  // Item 13.2/13.5: notifikasi hasil "Konfirmasi (n)" per grup -- ada yang di-skip (belum
  // ditimbang/masih claimable) atau tidak.
  const [confirmNotice, setConfirmNotice] = useState<string | null>(null);
  // Item 13.6: seksi "Riwayat timbang -- sudah dikonfirmasi" dibuat collapsible (default
  // tertutup) supaya tidak menyita layar -- ini murni read-only + tombol "Ajukan Claim".
  const [confirmedExpanded, setConfirmedExpanded] = useState(false);
  // Item 13.6: "Ajukan Claim" dari roll yang SUDAH dikonfirmasi -- roll ini terakhir kali
  // ditimbang & hasilnya dalam toleransi (kalau claimable, ia tidak akan pernah sampai
  // dikonfirmasi), jadi mengajukan claim di sini berarti timbang ULANG dulu (ketemu masalah baru
  // saat cek fisik) -- baru kalau hasil timbang ulang itu claimable, boleh lanjut ke dialog foto.
  const [reweighTarget, setReweighTarget] = useState<PendingWeighRoll | null>(null);
  const [reweighNetKg, setReweighNetKg] = useState(0);
  const [reweighError, setReweighError] = useState<string | null>(null);
  // Item 16: modal "Input/Perbaiki Hasil Cutting" sekarang di-scope ke SATU GRUP aduan/pola
  // (kode|lengan, sama seperti groupList di bawah) sekaligus, bukan satu batch/roll per modal.
  // Item 5 (feedback batch 2026-09-05): di-scope LEBIH LANJUT ke satu SESI RESTING ("Part") --
  // `activeCuttingGroupKey` sekarang berisi RestingSessionGroup.key penuh (sudah mengandung
  // mrpId|kode|lengan|restingAt), BUKAN lagi cuma "kode|lengan" -- lihat 5.6 kenapa modal TIDAK
  // boleh digabung lintas-Part: saveGroup menyetempel SATU cuttingAt ke semua batch di modal, dan
  // Part 1/Part 2 adalah stack fisik berbeda yang dipotong di waktu berbeda -- menggabungnya akan
  // memalsukan timestamp cutting & durasi/badge resting yang diturunkan darinya.
  const [activeCuttingGroupKey, setActiveCuttingGroupKey] = useState<string | null>(null);
  const [cuttingGroupDateDraft, setCuttingGroupDateDraft] = useState(nowLocalDatetime());
  // Item 14.2: "Isi semua roll tersedia" di form Resting butuh SATU nilai gramasi yang dipakai
  // buat mengisi semua baris otomatis -- baris tetap bisa diedit satu-satu sesudahnya.
  const [fillGramasi, setFillGramasi] = useState(0);
  // Item 5: expand/collapse per SESI RESTING ("Part") di tabel "Material dalam produksi" -- Set
  // multi-key (sama pola dengan expandedKoli di app/vendor-maklon/pengiriman/page.tsx) karena
  // banyak Part bisa di-expand independen sekaligus, beda dari confirmedExpanded di atas yang
  // cuma 1 seksi. Default collapsed (Set kosong).
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  function toggleSessionExpanded(key: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeStages: string[] = ["PARTIAL_WAITING_MATERIAL", "FULL_WAITING_MATERIAL", "PRODUCTION", "PARTIAL_PRODUCTION"];
  const readyMrpIds = maklonPOs
    .filter((p) => p.vendorProduksi === vendorId && p.approved && activeStages.includes(p.status) && materialReceivedForMaklon(p.mrpId, vendorId, invoices))
    .map((p) => p.mrpId);
  const readyMrps = mrpDetails.filter((d) => readyMrpIds.includes(d.mrp.id));

  const selectedDetail = mrpDetails.find((d) => d.mrp.id === selectedMrpId);
  const aduanRows = (selectedDetail?.aduanRows ?? []).filter((a) => a.vendor === vendorId);

  // Item 12/13: 3 daftar terpisah (lihat catatan panjang di derive.ts) -- pendingRows (belum
  // ditimbang/perlu timbang ulang), unconfirmedRows (sudah ditimbang, belum "Konfirmasi"),
  // confirmedRows (sudah dikonfirmasi, read-only + bisa ajukan claim).
  const pendingRows = selectedMrpId ? pendingWeighRolls(selectedMrpId, vendorId, invoices, productionBatches) : [];
  const unconfirmedRows = selectedMrpId ? weighedUnconfirmedRolls(selectedMrpId, vendorId, invoices, productionBatches) : [];
  const confirmedRows = selectedMrpId ? confirmedWeighedRolls(selectedMrpId, vendorId, invoices, productionBatches) : [];
  function weighKey(r: PendingWeighRoll): string {
    return `${r.invoiceId}|${r.warna}|${r.lengan}|${r.rollIndex}`;
  }
  // Item 14.1: grouping warna·lengan dipakai bareng untuk daftar 1 & 2 (pendingRows/unconfirmedRows).
  function groupByWarnaLengan(rows: PendingWeighRoll[]): { key: string; warna: string; lengan: Lengan; rows: PendingWeighRoll[] }[] {
    const map = new Map<string, { key: string; warna: string; lengan: Lengan; rows: PendingWeighRoll[] }>();
    for (const r of rows) {
      const key = r.warna + "|" + r.lengan;
      const g = map.get(key) ?? { key, warna: r.warna, lengan: r.lengan, rows: [] };
      g.rows.push(r);
      map.set(key, g);
    }
    return Array.from(map.values());
  }
  async function commitWeigh(r: PendingWeighRoll, netKg: number, claim?: { diffKg: number; pct: number }, photo?: { dataUrl: string; fileName?: string }) {
    const key = weighKey(r);
    setWeighError(null);
    try {
      await receiveRawMaterialRoll(r.invoiceId, r.warna, r.lengan, r.rollIndex, netKg, claim, codeRollDraft[key], photo);
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
  // Item 4.5: claimable (lebih RINGAN dari toleransi) -> antre ke dialog claim (butuh foto,
  // diproses satu-satu). Di luar toleransi tapi lebih BERAT -> disimpan LANGSUNG + catatan info
  // non-blocking. Dalam toleransi -> disimpan langsung seperti biasa.
  async function saveWeigh(r: PendingWeighRoll) {
    const key = weighKey(r);
    const netKg = weighDraft[key] ?? r.netKg ?? r.grossKg;
    const variance = weightVariance(r.grossKg, netKg);
    if (variance.claimable) {
      setClaimQueue((prev) => [...prev, { key, roll: r, netKg, diffKg: variance.diff, pct: variance.pct }]);
      return;
    }
    if (!variance.withinTolerance) {
      setOverWeightNotice(`${r.warna} · ${r.lengan} roll ${r.rollIndex + 1}: berat bersih lebih besar dari berat kotor (+${variance.pct.toFixed(1)}%) — disimpan, tidak diklaim.`);
    } else {
      setOverWeightNotice(null);
    }
    await commitWeigh(r, netKg);
  }
  // Item 14.1: "Simpan semua (n)" per grup -- setiap roll dengan input diproses SATU PER SATU
  // (await berurutan): dalam toleransi/over-weight disimpan langsung diam-diam, roll claimable
  // ditambahkan ke claimQueue (dialog fotonya muncul belakangan, setelah loop ini selesai).
  async function saveAllInGroup(rows: PendingWeighRoll[]) {
    for (const r of rows) {
      const key = weighKey(r);
      const netKg = weighDraft[key] ?? r.netKg ?? r.grossKg;
      const variance = weightVariance(r.grossKg, netKg);
      if (variance.claimable) {
        setClaimQueue((prev) => [...prev, { key, roll: r, netKg, diffKg: variance.diff, pct: variance.pct }]);
        continue;
      }
      await commitWeigh(r, netKg);
    }
  }
  // Item 13.5: "Konfirmasi (n)" per grup -- panggil confirmRollWeighAction untuk semua roll grup
  // sekaligus, server yang menentukan mana yang benar-benar lolos (net_kg terisi & tidak claimable).
  async function confirmGroup(rows: PendingWeighRoll[]) {
    const items = rows.map((r) => ({ invoiceId: r.invoiceId, warna: r.warna, lengan: r.lengan, rollIndex: r.rollIndex }));
    const result = await confirmRollWeigh(items);
    setConfirmNotice(
      result.skipped.length > 0
        ? `${result.confirmed} roll dikonfirmasi. ${result.skipped.length} roll dilewati (belum ditimbang atau masih claimable).`
        : `${result.confirmed} roll dikonfirmasi.`
    );
  }
  function resetClaimPhotoState() {
    setClaimPhotoDataUrl(null);
    setClaimPhotoFileName(undefined);
    setClaimPhotoError(null);
    setClaimPhotoBusy(false);
    // Dialog claim TETAP mounted saat antrean pindah ke roll berikutnya (claimQueue.shift), jadi
    // <input type="file"> yang sama dipakai ulang -- kosongkan value DOM-nya juga (lihat komentar
    // claimPhotoInputRef di atas) supaya foto yang sama bisa dipilih lagi untuk roll berikutnya.
    if (claimPhotoInputRef.current) claimPhotoInputRef.current.value = "";
  }
  async function onClaimPhotoSelected(file: File) {
    setClaimPhotoError(null);
    setClaimPhotoBusy(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      if (dataUrlApproxBytes(compressed) > MAX_CLAIM_PHOTO_BYTES) {
        setClaimPhotoError("Foto terlalu besar, ambil ulang dengan resolusi lebih kecil");
        setClaimPhotoDataUrl(null);
        return;
      }
      setClaimPhotoDataUrl(compressed);
      setClaimPhotoFileName(file.name);
    } catch (e) {
      setClaimPhotoError(e instanceof Error ? e.message : "Gagal memproses foto.");
    } finally {
      setClaimPhotoBusy(false);
    }
  }
  function cancelPendingClaim() {
    setClaimQueue((prev) => prev.slice(1));
    resetClaimPhotoState();
  }
  async function submitPendingClaim() {
    if (!pendingClaim || !claimPhotoDataUrl) return;
    await commitWeigh(pendingClaim.roll, pendingClaim.netKg, { diffKg: pendingClaim.diffKg, pct: pendingClaim.pct }, { dataUrl: claimPhotoDataUrl, fileName: claimPhotoFileName });
    setClaimQueue((prev) => prev.slice(1));
    resetClaimPhotoState();
  }
  // Item 13.6: "Ajukan Claim" dari roll yang sudah dikonfirmasi -- minta timbang ulang dulu (input
  // netKg baru), baru diperbolehkan lanjut ke antrean claim (foto) kalau hasilnya memang claimable.
  function openReweighClaim(r: PendingWeighRoll) {
    setReweighTarget(r);
    setReweighNetKg(r.netKg ?? r.grossKg);
    setReweighError(null);
  }
  function submitReweighClaim() {
    if (!reweighTarget) return;
    const variance = weightVariance(reweighTarget.grossKg, reweighNetKg);
    if (!variance.claimable) {
      setReweighError("Berat ini masih dalam toleransi (atau lebih berat dari berat kotor) -- bukan claim. Ubah dulu berat bersihnya kalau memang ada masalah fisik pada roll.");
      return;
    }
    setClaimQueue((prev) => [...prev, { key: weighKey(reweighTarget), roll: reweighTarget, netKg: reweighNetKg, diffKg: variance.diff, pct: variance.pct }]);
    setReweighTarget(null);
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

  // Item 14.2: "Isi semua roll tersedia (n)" -- 1 baris per code roll TERSEDIA (availableCodeRollsForColor)
  // untuk tiap warna di selectedGroup.rows, dibatasi ke masing-masing row.available (pool sudah
  // dialokasikan berurutan per baris lewat availableRollsByAduanRow, lihat availableByRow di atas)
  // supaya totalnya tetap pas dengan selectedGroup.totalAvailable. Gramasi diisi dari `fillGramasi`
  // (satu nilai untuk semua baris) -- baris manapun tetap bisa diedit satu-satu sesudahnya.
  function fillAllAvailable() {
    if (!selectedGroup) return;
    const next: CuttingLine[] = [];
    for (const row of selectedGroup.rows) {
      if (row.available <= 0) continue;
      const codes = availableCodeRollsForColor(selectedMrpId, row.warna, selectedGroup.lengan, vendorId, invoices, productionBatches);
      const take = Math.min(row.available, codes.length);
      for (let i = 0; i < take; i++) {
        // id key sengaja dari warna+codeRoll (bukan Date.now(), yang termasuk impure call yang
        // ditolak eslint react-hooks/purity kalau dipanggil langsung di badan fungsi komponen) --
        // codeRoll sudah unik per baris di sini jadi cukup buat React key/id.
        next.push({ id: "line-fill-" + row.warna + "-" + codes[i], warna: row.warna, codeRoll: codes[i], gramasi: fillGramasi });
      }
    }
    if (next.length > 0) setLines(next);
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
  // Item 5: satu-satunya sumber "sesi resting" (Part) untuk tabel "Material dalam produksi" DAN
  // modal Input Hasil Cutting -- dihitung sekali di sini supaya keduanya selalu konsisten.
  const sessionGroups = restingSessionGroups(myBatches);

  // Item 16: buka modal "Input/Perbaiki Hasil Cutting" untuk SATU SESI RESTING ("Part") --
  // listing semua batch sesi itu yang masih butuh aksi (belum cutting ATAU sudah cutting tapi
  // hasil aduannya kosong/nol semua, lihat batchNeedsCuttingInput), lintas warna. `kode`/`lengan`
  // dipertahankan di signature buat kejelasan pemanggil (lihat 5.4) walau sessionKey sendiri
  // sudah cukup unik (sudah mengandung mrpId|kode|lengan|restingAt).
  function openCuttingGroupModal(kode: string, lengan: Lengan, sessionKey: string) {
    void kode;
    void lengan;
    const session = sessionGroups.find((g) => g.key === sessionKey);
    const groupBatches = (session?.batches ?? []).filter(batchNeedsCuttingInput);
    setCuttingSizeDraft((prev) => {
      const next = { ...prev };
      for (const b of groupBatches) next[b.id] = next[b.id] ?? b.sizeQty ?? {};
      return next;
    });
    setCuttingGroupDateDraft(nowLocalDatetime());
    setActiveCuttingGroupKey(sessionKey);
  }
  function closeCuttingGroupModal() {
    setActiveCuttingGroupKey(null);
  }

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
              {pendingMarker(countCuttingAwaitingUpdateForMrp(d.mrp.id, vendorId, productionBatches, invoices), "roll belum selesai")}
            </option>
          ))}
        </select>
        {readyMrps.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP dengan bahan siap dan pekerjaan belum selesai.</div>}
      </div>

      {selectedMrpId && (pendingRows.length > 0 || unconfirmedRows.length > 0 || confirmedRows.length > 0) && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-4 py-2.5 font-sans text-[11px] leading-[1.5] text-info-fg">
          Timbang → Konfirmasi → baru bisa dipilih di Resting. Claim tetap bisa diajukan setelah dikonfirmasi selama roll belum dipotong.
        </div>
      )}

      {selectedMrpId && pendingRows.length > 0 && (
        <div className="w-full overflow-x-auto rounded-lg border border-[#F0DFC2] bg-warning-bg">
          <div className="border-b border-[#F0DFC2] px-4 py-3 font-sans text-[13px] font-semibold text-warning-fg">
            Timbang roll — {pendingRows.length} roll perlu ditimbang atau ditimbang ulang
          </div>
          <div className="border-b border-[#F0DFC2] bg-white/60 px-4 py-2 font-sans text-[11px] leading-[1.5] text-warning-fg">
            Roll yang sudah disimpan pindah ke panel &quot;Sudah ditimbang — belum dikonfirmasi&quot; di bawah. Roll yang selisih beratnya kurang dari
            toleransi (claim) TERKUNCI (tidak bisa ditimbang ulang) sampai proses retur ke Procurement selesai.
          </div>
          {weighError && (
            <div className="border-b border-[#F0DFC2] bg-danger-bg px-4 py-2 font-sans text-[11px] leading-[1.5] text-danger-fg">{weighError}</div>
          )}
          {overWeightNotice && (
            <div className="border-b border-[#F0DFC2] bg-info-bg px-4 py-2 font-sans text-[11px] leading-[1.5] text-info-fg">{overWeightNotice}</div>
          )}
          {groupByWarnaLengan(pendingRows).map((g) => (
            <div key={g.key} className="border-b border-[#F0DFC2] last:border-b-0">
              <div className="flex items-center justify-between gap-2 bg-white/50 px-4 py-2">
                <span className="font-sans text-[12px] font-semibold text-warning-fg">
                  {g.warna} · {g.lengan} ({g.rows.length})
                </span>
                <Button onClick={() => saveAllInGroup(g.rows)} variant="primary" size="xs">
                  Simpan semua ({g.rows.length})
                </Button>
              </div>
              <div
                className="grid min-w-[820px] gap-x-3 border-b border-[#F0DFC2] bg-white/40 px-4 py-[7px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
                style={{ gridTemplateColumns: "minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.8fr) minmax(110px,0.9fr)" }}
              >
                <span>Roll</span>
                <span>Code Roll</span>
                <span className="text-right">Berat kotor (kg)</span>
                <span className="text-right">Berat bersih (kg)</span>
                <span className="text-right">Selisih</span>
                <span>Toleransi</span>
                <span>Aksi</span>
              </div>
              {g.rows.map((r) => {
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
                const hasActiveClaim = !!savedVariance?.claimable && stage !== "SELESAI";
                const locked = hasActiveClaim && stage !== "RETUR_DITERIMA";
                const unlockedForReweigh = hasActiveClaim && stage === "RETUR_DITERIMA";
                const delivery = materialClaimReturDeliveries[key];
                const stageBanner: Record<Exclude<MaterialClaimStage, "SELESAI">, { tone: string; text: string }> = {
                  BELUM: {
                    tone: "bg-danger-bg text-danger-fg",
                    text: "Selisih berat kurang dari toleransi — sudah dikirim ke Procurement (lihat Klaim Material). Roll ini TERKUNCI, tidak bisa ditimbang ulang sampai Procurement atur retur & kirim roll pengganti.",
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
                  <div key={key} className="border-b border-[#F1F4F7] last:border-b-0">
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
                      className="grid min-w-[820px] items-center gap-x-3 bg-white px-4 py-[11px] font-sans text-xs text-[#31414F]"
                      style={{ gridTemplateColumns: "minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.8fr) minmax(110px,0.9fr)" }}
                    >
                      <span className="font-mono font-medium">
                        Roll {r.rollIndex + 1}
                        {locked && <span className="ml-1.5 font-mono text-[10px] text-danger-fg">(terkunci)</span>}
                        {unlockedForReweigh && <span className="ml-1.5 font-mono text-[10px] text-success-fg">(timbang ulang)</span>}
                      </span>
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
                      <span className={"text-right font-mono " + (variance.claimable ? "text-danger-fg" : variance.withinTolerance ? "text-success-fg" : "text-warning-fg")}>
                        {variance.diff >= 0 ? "+" : ""}
                        {formatDecimal(variance.diff)} kg ({variance.pct.toFixed(1)}%)
                      </span>
                      <span>
                        <StatusPill tone={variance.withinTolerance ? "success" : variance.claimable ? "danger" : "warning"}>
                          {variance.withinTolerance ? "SESUAI" : "DI LUAR TOLERANSI"}
                        </StatusPill>
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
          ))}
        </div>
      )}

      {selectedMrpId && unconfirmedRows.length > 0 && (
        <div className="w-full overflow-x-auto rounded-lg border border-[#CFE0EF] bg-info-bg">
          <div className="border-b border-[#CFE0EF] px-4 py-3 font-sans text-[13px] font-semibold text-info-fg">
            Sudah ditimbang — belum dikonfirmasi ({unconfirmedRows.length})
          </div>
          {confirmNotice && (
            <div className="border-b border-[#CFE0EF] bg-white/60 px-4 py-2 font-sans text-[11px] leading-[1.5] text-info-fg">{confirmNotice}</div>
          )}
          {groupByWarnaLengan(unconfirmedRows).map((g) => (
            <div key={g.key} className="border-b border-[#CFE0EF] last:border-b-0">
              <div className="flex items-center justify-between gap-2 bg-white/50 px-4 py-2">
                <span className="font-sans text-[12px] font-semibold text-info-fg">
                  {g.warna} · {g.lengan} ({g.rows.length})
                </span>
                <Button onClick={() => confirmGroup(g.rows)} variant="success" size="xs">
                  Konfirmasi ({g.rows.length}) →
                </Button>
              </div>
              <div
                className="grid min-w-[760px] gap-x-3 border-b border-[#CFE0EF] bg-white/40 px-4 py-[7px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
                style={{ gridTemplateColumns: "minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.9fr)" }}
              >
                <span>Roll</span>
                <span>Code Roll</span>
                <span className="text-right">Berat kotor (kg)</span>
                <span className="text-right">Berat bersih (kg)</span>
                <span className="text-right">Selisih</span>
                <span>Aksi</span>
              </div>
              {g.rows.map((r) => {
                const key = weighKey(r);
                const netVal = weighDraft[key] ?? r.netKg ?? r.grossKg;
                const variance = weightVariance(r.grossKg, netVal);
                return (
                  <div
                    key={key}
                    className="grid min-w-[760px] items-center gap-x-3 border-b border-[#F1F4F7] bg-white px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                    style={{ gridTemplateColumns: "minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(120px,1fr) minmax(110px,0.9fr)" }}
                  >
                    <span className="font-mono font-medium">Roll {r.rollIndex + 1}</span>
                    <span className="font-mono text-[11px]">{r.codeRoll || "—"}</span>
                    <span className="text-right font-mono">{formatDecimal(r.grossKg)}</span>
                    <span className="flex justify-end">
                      <NumberInput value={netVal} decimals={2} onChange={(v) => setWeighDraft((prev) => ({ ...prev, [key]: v }))} className="input w-[100px] text-right" />
                    </span>
                    <span className={"text-right font-mono " + (variance.claimable ? "text-danger-fg" : "text-success-fg")}>
                      {variance.diff >= 0 ? "+" : ""}
                      {formatDecimal(variance.diff)} kg ({variance.pct.toFixed(1)}%)
                    </span>
                    <span>
                      <Button onClick={() => saveWeigh(r)} variant="primary" size="xs">
                        Simpan
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {selectedMrpId && confirmedRows.length > 0 && (
        <div className="w-full overflow-x-auto rounded-lg border border-border-subtle bg-surface-card">
          <button
            onClick={() => setConfirmedExpanded((v) => !v)}
            className="flex w-full items-center justify-between border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary"
          >
            Riwayat timbang — sudah dikonfirmasi ({confirmedRows.length})
            <span className="font-sans text-[11px] font-semibold text-action-primary">{confirmedExpanded ? "Sembunyikan" : "Lihat →"}</span>
          </button>
          {confirmedExpanded && (
            <div
              className="grid min-w-[760px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[7px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "minmax(120px,0.9fr) minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(140px,1fr) minmax(110px,0.9fr)" }}
            >
              <span>Warna / lengan</span>
              <span>Roll</span>
              <span>Code Roll</span>
              <span className="text-right">Berat bersih (kg)</span>
              <span>Dikonfirmasi</span>
              <span>Aksi</span>
            </div>
          )}
          {confirmedExpanded &&
            confirmedRows.map((r) => {
              const key = weighKey(r);
              return (
                <div
                  key={key}
                  className="grid min-w-[760px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                  style={{ gridTemplateColumns: "minmax(120px,0.9fr) minmax(70px,0.6fr) minmax(120px,0.9fr) minmax(110px,0.9fr) minmax(140px,1fr) minmax(110px,0.9fr)" }}
                >
                  <span>
                    {r.warna} · {r.lengan}
                  </span>
                  <span className="font-mono font-medium">Roll {r.rollIndex + 1}</span>
                  <span className="font-mono text-[11px]">{r.codeRoll || "—"}</span>
                  <span className="text-right font-mono">{formatDecimal(r.netKg ?? 0)}</span>
                  <span className="font-mono text-[11px] text-text-muted">{formatDateTime(r.weighConfirmedAt)}</span>
                  <span>
                    <Button onClick={() => openReweighClaim(r)} variant="danger" size="xs">
                      Ajukan Claim
                    </Button>
                  </span>
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
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Gramasi (isi otomatis)</div>
                  <NumberInput value={fillGramasi} onChange={setFillGramasi} decimals={0} className="input mt-1 w-[90px]" />
                </div>
                <button
                  onClick={fillAllAvailable}
                  disabled={selectedGroup.totalAvailable <= 0}
                  title="Buat 1 baris untuk tiap code roll yang masih tersedia di grup ini, pre-filled gramasi di samping"
                  className="rounded-md border border-accent-blue bg-white px-2.5 py-[8px] font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Isi semua roll tersedia ({selectedGroup.totalAvailable})
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
              className="grid min-w-[1550px] gap-x-5 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{
                gridTemplateColumns: CUTTING_SESSION_COLUMNS,
              }}
            >
              <span>MRP</span>
              <span>Kode</span>
              <span>Part</span>
              <span>Warna</span>
              <span className="text-right">Roll</span>
              <span>Resting</span>
              <span>Cutting</span>
              <span>Durasi Resting</span>
              <span>Status Resting</span>
              <span>Hasil Aduan / Yield</span>
              <span />
            </div>
            {sessionGroups.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada batch produksi.</div>}
            {sessionGroups.map((g) => {
              const isExpanded = expandedSessions.has(g.key);
              const detail = mrpDetails.find((d) => d.mrp.id === g.mrpId);
              const distinctWarna = Array.from(new Set(g.batches.map((b) => b.warna))).join(", ");
              const anyMissingCuttingAt = g.batches.some((b) => !b.cuttingAt);
              const anyNeedsInput = g.batches.some((b) => batchNeedsCuttingInput(b));
              const sessionComplete = !anyMissingCuttingAt && !anyNeedsInput;
              const cuttingAts = g.batches.map((b) => b.cuttingAt).filter((c): c is string => !!c);
              // "Kalau mereka pernah berbeda, tampilkan yang paling awal" (5.2) -- normalnya semua
              // identik karena saveGroup menyetempel SATU cuttingAt untuk semua batch di grup ini.
              const earliestCuttingAt = cuttingAts.length > 0 ? cuttingAts.reduce((min, c) => (Date.parse(c) < Date.parse(min) ? c : min)) : undefined;
              const durasiKurang = g.batches.some((b) => b.cuttingAt && restingMinutes(g.restingAt, b.cuttingAt) < RESTING_TARGET_MINUTES);
              const filledCount = g.batches.filter((b) => !!b.sizeQty).length;
              const totalTarget = g.batches.reduce((sum, b) => sum + Object.values(targetSizesForBatch(b, detail?.aduanRows ?? [])).reduce((a, c) => a + c, 0), 0);
              const totalActual = g.batches.reduce((sum, b) => sum + (b.sizeQty ? Object.values(b.sizeQty).reduce((a, c) => a + c, 0) : 0), 0);
              const groupYieldPct = filledCount === g.batches.length && totalTarget > 0 ? (totalActual / totalTarget) * 100 : null;
              const groupYieldAlert = groupYieldPct !== null && groupYieldPct < YIELD_ALERT_THRESHOLD_PCT;
              return (
                <div key={g.key} className="border-b border-[#F1F4F7] last:border-b-0">
                  <div className="grid min-w-[1550px] items-center gap-x-5 px-4 py-[11px] font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: CUTTING_SESSION_COLUMNS }}>
                    <span className="font-mono">{g.mrpId}</span>
                    <span className="font-mono font-medium">
                      {g.kode} · {g.lengan}
                    </span>
                    <span>
                      Part {g.partNo}
                      {g.partTotal > 1 && <span className="ml-1 font-mono text-[10px] text-text-muted">dari {g.partTotal}</span>}
                    </span>
                    <span>{distinctWarna}</span>
                    <span className="text-right font-mono">{g.batches.length}</span>
                    <span className="font-mono text-[11px]">{formatDateTime(g.restingAt)}</span>
                    <span className="font-mono text-[11px]">
                      {sessionComplete ? (
                        formatDateTime(earliestCuttingAt ?? g.restingAt)
                      ) : (
                        <Button onClick={() => openCuttingGroupModal(g.kode, g.lengan, g.key)} variant="primary" size="xs">
                          {anyMissingCuttingAt ? "Input Hasil Cutting →" : "Perbaiki Hasil Cutting →"}
                        </Button>
                      )}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{formatDuration(g.restingAt, earliestCuttingAt ?? new Date().toISOString())}</span>
                    <span>{durasiKurang && <StatusPill tone="warning">RESTING KURANG DARI TARGET</StatusPill>}</span>
                    <span className="flex flex-col gap-0.5 font-mono text-[11px]">
                      {filledCount === 0 ? (
                        <span className="text-text-muted">Target: {totalTarget} pcs</span>
                      ) : filledCount < g.batches.length ? (
                        <span className="text-text-muted">
                          {filledCount}/{g.batches.length} roll terisi
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          <span>
                            {totalActual} / {totalTarget} pcs
                          </span>
                          {groupYieldPct !== null && <StatusPill tone={groupYieldAlert ? "danger" : "success"}>{groupYieldPct.toFixed(1)}%</StatusPill>}
                        </span>
                      )}
                    </span>
                    <span className="text-right">
                      <button onClick={() => toggleSessionExpanded(g.key)} className="font-sans text-[11px] font-semibold text-action-primary">
                        {isExpanded ? "Sembunyikan" : "Lihat roll →"}
                      </button>
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="bg-[#FAFBFC]">
                      <div
                        className="grid min-w-[1550px] gap-x-3 border-y border-[#F1F4F7] bg-[#F2F4F7] px-8 py-[7px] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted"
                        style={{ gridTemplateColumns: CUTTING_BATCH_COLUMNS }}
                      >
                        <span>Warna</span>
                        <span>Code roll</span>
                        <span className="text-right">Gramasi</span>
                        <span>Cutting</span>
                        <span>Hasil Aduan / Yield</span>
                      </div>
                      {g.batches.map((b) => {
                        // Item 5.3: blok kalkulasi per-roll ini SENGAJA verbatim sama dengan yang
                        // dulu dipakai langsung di baris tabel (sebelum direstruktur jadi grup) --
                        // lihat catatan derive.ts targetSizesForBatch/cuttingSizesForGroup.
                        const targetSizes = targetSizesForBatch(b, detail?.aduanRows ?? []);
                        const targetTotal = Object.values(targetSizes).reduce((a, c) => a + c, 0);
                        const actualTotal = b.sizeQty ? Object.values(b.sizeQty).reduce((a, c) => a + c, 0) : 0;
                        const yieldPct = targetTotal > 0 && b.sizeQty ? (actualTotal / targetTotal) * 100 : null;
                        const yieldAlert = yieldPct !== null && yieldPct < YIELD_ALERT_THRESHOLD_PCT;
                        const sizesForDetail = Array.from(new Set([...Object.keys(targetSizes), ...Object.keys(b.sizeQty ?? {})]));
                        return (
                          <div
                            key={b.id}
                            className="grid min-w-[1550px] items-center gap-x-3 border-b border-[#F1F4F7] px-8 py-[9px] font-sans text-xs text-[#31414F] last:border-b-0"
                            style={{ gridTemplateColumns: CUTTING_BATCH_COLUMNS }}
                          >
                            <span>{b.warna}</span>
                            <span className="font-mono text-[11px]">{b.codeRoll || "—"}</span>
                            <span className="text-right font-mono">{b.gramasi} gsm</span>
                            <span className="font-mono text-[11px]">{b.cuttingAt ? formatDateTime(b.cuttingAt) : "—"}</span>
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

      {activeCuttingGroupKey &&
        (() => {
          // Item 5.5: modal di-scope ke SATU SESI RESTING ("Part"), bukan lagi kode+lengan lintas
          // semua Part -- cari sesinya dari sessionGroups (satu-satunya sumber, sama dengan tabel
          // di atas) lewat key penuhnya, baru filter batch yang masih butuh aksi di sesi itu SAJA.
          const session = sessionGroups.find((g) => g.key === activeCuttingGroupKey);
          if (!session) return null;
          const { kode, lengan, partNo } = session;
          const groupBatches = session.batches.filter(batchNeedsCuttingInput);
          if (groupBatches.length === 0) return null;
          const byWarna = new Map<string, typeof groupBatches>();
          for (const b of groupBatches) byWarna.set(b.warna, [...(byWarna.get(b.warna) ?? []), b]);
          // Item 16.3: tidak bisa Simpan sampai SEMUA batch di modal ini punya minimal 1 size
          // bukan-nol -- baris yang di-"Perbaiki" boleh mulai dari state non-zero yang sudah
          // tersimpan sebelumnya (prefilled di openCuttingGroupModal), jadi otomatis lolos.
          const incompleteIds = groupBatches.filter((b) => {
            const draft = cuttingSizeDraft[b.id] ?? {};
            return Object.values(draft).every((v) => !v || v <= 0);
          });
          const canSaveGroup = incompleteIds.length === 0;
          async function saveGroup() {
            if (!canSaveGroup) return;
            const effectiveDate = toUtcIso(cuttingGroupDateDraft);
            for (const b of groupBatches) {
              await updateBatchToCutting(b.id, effectiveDate, cuttingSizeDraft[b.id] ?? {});
            }
            closeCuttingGroupModal();
          }
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
              <div className="w-full max-w-[720px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
                <div className="border-b border-border-subtle px-5 py-3.5">
                  <span className="font-sans text-[13px] font-semibold text-text-primary">
                    Input Hasil Cutting — {kode} · {lengan} · Part {partNo} ({groupBatches.length} roll)
                  </span>
                </div>
                <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Tanggal &amp; jam cutting (berlaku untuk semua roll di grup ini)</div>
                  <input
                    type="datetime-local"
                    value={cuttingGroupDateDraft}
                    onChange={(e) => setCuttingGroupDateDraft(e.target.value)}
                    className="input mt-1"
                  />

                  {Array.from(byWarna.entries()).map(([warna, batches]) => (
                    <div key={warna} className="mt-4">
                      <div className="border-b border-[#CFE0EF] pb-1 font-sans text-[12px] font-semibold text-info-fg">{warna}</div>
                      {batches.map((b) => {
                        const detail = mrpDetails.find((d) => d.mrp.id === b.mrpId);
                        const targetSizes = targetSizesForBatch(b, detail?.aduanRows ?? []);
                        const targetTotal = Object.values(targetSizes).reduce((a, c) => a + c, 0);
                        const sizeDraft = cuttingSizeDraft[b.id] ?? {};
                        const actualTotal = Object.values(sizeDraft).reduce((a, c) => a + c, 0);
                        const isIncomplete = incompleteIds.some((x) => x.id === b.id);
                        return (
                          <div key={b.id} className="mt-2.5 rounded-md border border-[#F1F4F7] bg-[#FAFBFC] p-3">
                            <div className="font-sans text-[11px] font-medium text-text-muted">
                              Roll {b.qtyRoll} — {b.codeRoll || "—"} (target {targetTotal} pcs){b.cuttingAt && <span className="ml-1.5 text-warning-fg">(perbaiki)</span>}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-2">
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
                            {isIncomplete && <div className="mt-1.5 font-sans text-[10.5px] text-danger-fg">Hasil cutting wajib diisi</div>}
                            {!isIncomplete && targetTotal > 0 && actualTotal > 0 && actualTotal / targetTotal < YIELD_ALERT_THRESHOLD_PCT / 100 && (
                              <div className="mt-1.5 font-sans text-[10.5px] text-danger-fg">
                                Yield {((actualTotal / targetTotal) * 100).toFixed(1)}% — di bawah baseline {YIELD_ALERT_THRESHOLD_PCT}%, akan masuk alert yield ke portal Produksi.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
                  <button onClick={closeCuttingGroupModal} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                    Batal
                  </button>
                  <Button onClick={saveGroup} disabled={!canSaveGroup} variant="success" size="sm">
                    Simpan
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

      {reweighTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="w-full max-w-[420px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5">
              <span className="font-sans text-[13px] font-semibold text-text-primary">
                Ajukan Claim — {reweighTarget.warna} · {reweighTarget.lengan} — Roll {reweighTarget.rollIndex + 1}
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="font-sans text-[11px] text-text-muted">
                Roll ini sudah dikonfirmasi (berat sebelumnya {formatDecimal(reweighTarget.netKg ?? 0)} kg, kotor {formatDecimal(reweighTarget.grossKg)} kg). Timbang
                ulang dulu di sini kalau ada masalah fisik yang baru diketahui — claim cuma bisa diajukan kalau hasilnya lebih ringan dari toleransi.
              </div>
              <div className="mt-2.5 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Berat bersih hasil timbang ulang (kg)</div>
              <NumberInput value={reweighNetKg} decimals={2} onChange={setReweighNetKg} className="input mt-1 w-[140px]" />
              {reweighError && <div className="mt-2 font-sans text-[11px] text-danger-fg">{reweighError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button
                onClick={() => setReweighTarget(null)}
                className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary"
              >
                Batal
              </button>
              <button onClick={submitReweighClaim} className="rounded-md bg-danger px-3.5 py-[7px] font-sans text-xs font-semibold text-white">
                Lanjut ke Claim →
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45">
          <div className="w-full max-w-[460px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-danger-bg bg-danger-bg px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-danger" />
                <span className="font-sans text-[13px] font-semibold text-danger-fg">Selisih berat kurang dari toleransi</span>
                {claimQueue.length > 1 && <span className="ml-auto font-mono text-[10.5px] text-danger-fg">{claimQueue.length} antrean</span>}
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-sans text-xs text-[#31414F]">
                {pendingClaim.roll.warna} · {pendingClaim.roll.lengan} — Roll {pendingClaim.roll.rollIndex + 1} — selisih {pendingClaim.diffKg >= 0 ? "+" : ""}
                {formatDecimal(pendingClaim.diffKg)} kg ({pendingClaim.pct.toFixed(1)}%), kurang dari toleransi ±2%.
              </div>
              <div className="mt-2 font-sans text-xs text-text-muted">Kirim claim ke Procurement supaya selisih ini dicatat dan bisa ditindaklanjuti?</div>

              <div className="mt-3 font-sans text-[11px] font-semibold text-text-primary">
                Foto bukti berat bersih — <span className="text-danger-fg">wajib</span>
              </div>
              <div className="mt-1.5 rounded-md border border-dashed border-[#CBD5DF] bg-[#FAFBFC] p-3">
                <input
                  ref={claimPhotoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onClaimPhotoSelected(file);
                  }}
                  className="input w-full file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
                />
                {!claimPhotoDataUrl && !claimPhotoBusy && !claimPhotoError && (
                  <div className="mt-1.5 font-sans text-[11px] text-text-muted">Belum ada foto — wajib sebelum claim bisa dikirim.</div>
                )}
                {claimPhotoBusy && <div className="mt-1.5 font-sans text-[11px] text-text-muted">Memproses foto…</div>}
                {claimPhotoError && <div className="mt-1.5 font-sans text-[11px] text-danger-fg">{claimPhotoError}</div>}
                {claimPhotoDataUrl && !claimPhotoBusy && !claimPhotoError && (
                  <div className="mt-1.5 flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- preview data URI base64, bukan aset statis (lihat compressImageToDataUrl di atas) */}
                    <img src={claimPhotoDataUrl} alt="Foto bukti berat bersih" className="h-16 w-16 rounded-md border border-[#E4E8EE] object-cover" />
                    <div>
                      <div className="font-sans text-[11px] text-success-fg">✓ {claimPhotoFileName} terupload.</div>
                      <button
                        onClick={() => {
                          setClaimPhotoDataUrl(null);
                          setClaimPhotoFileName(undefined);
                          // Kosongkan value DOM-nya juga -- lihat komentar claimPhotoInputRef di atas.
                          if (claimPhotoInputRef.current) claimPhotoInputRef.current.value = "";
                        }}
                        className="mt-0.5 font-sans text-[10.5px] font-semibold text-action-primary underline"
                      >
                        Ganti foto
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={cancelPendingClaim} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <button
                onClick={submitPendingClaim}
                disabled={!claimPhotoDataUrl || claimPhotoBusy}
                className="rounded-md bg-danger px-3.5 py-[7px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
