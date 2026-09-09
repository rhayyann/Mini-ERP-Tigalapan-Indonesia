import { EKSPEDISI_RATES, MATERIAL_RATE_PER_ROLL, ROLL_KG_ESTIMATE, VENDOR_PRODUKSI } from "./seed";
import type { MrpDetail, PpicApprovalStatus } from "./store";
import type { HargaKainPksRow, HargaKainRow, HargaMaklonRow, SupplierRow, VendorProduksiMasterRow } from "./masterData";
import type { AduanPolaRow, ColorBreakdown, DeliveryKoli, Lengan, LenganGroup, MaklonInvoice, MaklonPO, MaterialPO, MaterialRow, Mrp, ProductionBatch, ProductionGroupMeta, ProductionResult, ProductionResultKind, ProductionYieldResolution, RawMaterialInvoice, ShippableKind, Usia, VendorDepositEntry, VendorInvoice, VendorInvoiceLine } from "./types";

export function formatRupiah(n: number) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export function formatPcs(n: number) {
  return n.toLocaleString("id-ID");
}

/** Daftar nama supplier material untuk dropdown "Vendor material" saat bikin PO — digabung dari
 *  DUA sumber: nama supplier unik yang sudah ada di Master Data "Harga Kain" (sumber utama,
 *  otomatis ikut bertambah begitu import/edit Harga Kain), DITAMBAH daftar manual di tab
 *  "Supplier" (untuk supplier yang belum sempat masuk Harga Kain). Dulu dropdown ini cuma pakai
 *  daftar manual terpisah, jadi 468 baris supplier real dari import Harga Kain tidak pernah
 *  muncul di sini — bikin user bingung kenapa listnya "masih yang lama". */
export function materialSupplierNames(hargaKain: HargaKainRow[], supplierList: SupplierRow[]): string[] {
  const names = new Set<string>();
  for (const r of hargaKain) if (r.namaSupplier) names.add(r.namaSupplier);
  for (const r of supplierList) if (r.nama) names.add(r.nama);
  return Array.from(names).sort((a, b) => a.localeCompare(b, "id-ID"));
}

/** Sama seperti materialSupplierNames, tapi DIPERSEMPIT ke supplier yang benar-benar punya
 *  harga untuk `warna` tertentu di Harga Kain — supaya Procurement tidak bisa memilih kombinasi
 *  supplier+warna yang tidak ada harganya sama sekali (yang berujung PO jatuh ke fallback
 *  "Estimasi" pakai angka flat lama yang jauh di bawah harga pasar, lihat hargaKainRateInfo).
 *  Daftar manual di tab "Supplier" TETAP ikut ditampilkan untuk semua warna (itu memang
 *  pelengkap yang sengaja belum ada data harganya — user yang pilih itu tahu risikonya). */
export function materialSupplierNamesForWarna(hargaKain: HargaKainRow[], supplierList: SupplierRow[], warna: string): string[] {
  const names = new Set<string>();
  for (const r of hargaKain) if (r.namaSupplier && normKey(r.warna) === normKey(warna)) names.add(r.namaSupplier);
  for (const r of supplierList) if (r.nama) names.add(r.nama);
  return Array.from(names).sort((a, b) => a.localeCompare(b, "id-ID"));
}

export type MaterialGroupByWarna = {
  warna: string;
  totalRoll: number;
  totalRibKg: number;
  supplier: string | null;
  rowIds: string[];
};

/** Gabungkan materialRows per WARNA (bukan per warna+lengan lagi) — bahan baku dipesan dari 1
 *  supplier per warna terlepas dari lengan-nya pendek/panjang, jadi pemilihan vendor material di
 *  PO Approval juga digabung jadi 1 keputusan per warna, roll & rib kg-nya dijumlahkan. Kalau
 *  baris2 dalam 1 warna kebetulan sudah punya supplier BEDA (mis. sisa dari sebelum digabung),
 *  supplier pertama yang non-null dipakai sebagai representasi tampilan — begitu user pilih
 *  ulang, assignMaterialSupplier diterapkan ke semua rowIds sekaligus supaya konsisten lagi. */
export function materialGroupsByWarna(materialRows: MaterialRow[]): MaterialGroupByWarna[] {
  const map = new Map<string, MaterialGroupByWarna>();
  for (const m of materialRows) {
    const cur = map.get(m.warna) ?? { warna: m.warna, totalRoll: 0, totalRibKg: 0, supplier: null, rowIds: [] };
    cur.totalRoll += m.qtyRoll;
    cur.totalRibKg += m.ribKg;
    if (!cur.supplier && m.supplier) cur.supplier = m.supplier;
    cur.rowIds.push(m.id);
    map.set(m.warna, cur);
  }
  // Sort eksplisit by warna -- Map insertion order sebelumnya dipakai apa adanya, yang berarti
  // urutannya cuma sama dengan urutan `materialRows` datang dari Supabase. Query-nya sendiri
  // TIDAK punya `.order()` (lihat snapshot.ts), jadi urutan fisik baris di Postgres bisa berubah
  // stelah UPDATE (mis. assignMaterialSupplierAction) -- bikin daftar warna kelihatan "acak
  // ulang" urutannya cuma karena user pilih vendor untuk satu warna. Sort di sini menjamin
  // urutan selalu sama terlepas dari urutan fetch.
  return Array.from(map.values()).sort((a, b) => a.warna.localeCompare(b.warna));
}

// ===== Fase 2: kalkulasi PO Bahan & PO Maklon dari Master Data =====
// Menggantikan estimasi flat lama (MATERIAL_RATE_PER_ROLL/roll, VENDOR_PRODUKSI.ratePerPc/pc)
// dengan lookup ke Master Data (Harga Kain/Harga Kain PKS, Harga Maklon) yang sudah diimpor dari
// Google Sheets. Lihat lib/mrp/masterData.ts untuk penjelasan tipe & batasan scope fase ini.

function normKey(s: string): string {
  return s.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** Match Harga Maklon row ke vendor key internal app (mis. "BAYU","GI-01") — cocokkan ke
 *  KODE VENDOR atau NAMA VENDOR mana saja yang match, karena sheet sumber TIDAK konsisten kolom
 *  mana yang sama dengan key app (GI-01: kodeVendor="GI-01" match; BAYU: namaVendor="BAYU"
 *  match, kodeVendor-nya malah "BY"). */
export function hargaMaklonRowMatchesVendor(row: HargaMaklonRow, vendorKey: string): boolean {
  const k = normKey(vendorKey);
  return normKey(row.kodeVendor) === k || normKey(row.namaVendor) === k;
}

function matchesLengan(tipeLengan: string, lengan: Lengan): boolean {
  const t = normKey(tipeLengan);
  return lengan === "PENDEK" ? t === "PDK" || t === "PENDEK" : t === "PJG" || t === "PANJANG";
}
// Exact-match (bukan includes) — tipeLengan seperti "Wangky PDK" jadi "WANGKYPDK" setelah
// dinormalisasi, tidak pernah persis sama dengan "PDK", jadi baris itu otomatis inert (tidak
// pernah cocok apapun) tanpa perlu ditolak eksplisit — lihat catatan di HargaMaklonRow.

/** Sumber rate yang kepakai — dipakai untuk label "Standar"/"PKS" di UI (lihat
 *  maklonRateExplanation/materialRateExplanation) supaya user tahu KENAPA suatu PO dapat harga
 *  tertentu, bukan cuma angka akhirnya. "Estimasi" = tidak ada row Master Data yang cocok sama
 *  sekali, jadi jatuh ke fallback flat lama. */
export type RateSource = "PKS" | "Standar" | "Estimasi";

export type MaklonRateInfo = { rate: number; source: RateSource; cumulativeQty: number; band?: HargaMaklonRow };

/** Cari rate Harga Maklon untuk vendor+lengan+kapasitas kumulatif — pilih band PKS dengan
 *  kapasitasMin TERTINGGI yang masih terpenuhi (band paling spesifik/tinggi yang tercapai),
 *  fallback ke baris Standar vendor itu, fallback terakhir ke VENDOR_PRODUKSI.ratePerPc kalau
 *  vendor itu sama sekali tidak ada row-nya di Master Data. */
export function hargaMaklonRateInfo(hargaMaklon: HargaMaklonRow[], vendorKey: string, lengan: Lengan, cumulativeQty: number): MaklonRateInfo {
  const rows = hargaMaklon.filter((r) => hargaMaklonRowMatchesVendor(r, vendorKey) && matchesLengan(r.tipeLengan, lengan));
  const pks = rows.filter((r) => r.jenisHarga === "PKS" && cumulativeQty >= (r.kapasitasMin ?? 0) && cumulativeQty < (r.kapasitasMax ?? Infinity));
  if (pks.length > 0) {
    const best = pks.reduce((a, b) => ((b.kapasitasMin ?? 0) > (a.kapasitasMin ?? 0) ? b : a));
    return { rate: best.harga, source: "PKS", cumulativeQty, band: best };
  }
  const standar = rows.find((r) => r.jenisHarga === "Standar");
  if (standar) return { rate: standar.harga, source: "Standar", cumulativeQty, band: standar };
  return { rate: VENDOR_PRODUKSI[vendorKey]?.ratePerPc ?? 7000, source: "Estimasi", cumulativeQty };
}

export function hargaMaklonRate(hargaMaklon: HargaMaklonRow[], vendorKey: string, lengan: Lengan, cumulativeQty: number): number {
  return hargaMaklonRateInfo(hargaMaklon, vendorKey, lengan, cumulativeQty).rate;
}

export type MaterialRateInfo = { rate: number; source: RateSource; totalKg: number; band?: HargaKainPksRow };

/** Cari rate Harga Kain untuk supplier+warna+total kg — pola sama seperti hargaMaklonRateInfo:
 *  band PKS (unit-aware TON/KG lewat kolom `satuan`) dengan tonaseMin TERTINGGI yang terpenuhi,
 *  fallback ke harga flat Harga Kain, fallback terakhir ke MATERIAL_RATE_PER_ROLL/25 (setara
 *  per-kg) kalau supplier+warna itu sama sekali tidak ada di Master Data manapun. Kolom
 *  `kategori` SENGAJA diabaikan — ColorBreakdown/MaterialPO tidak punya field kategori, warna
 *  string di data yang ada sudah unik mencakup itu (mis. "ABU MUDA 24S"). */
export function hargaKainRateInfo(hargaKain: HargaKainRow[], hargaKainPks: HargaKainPksRow[], supplierName: string, warna: string, totalKg: number): MaterialRateInfo {
  const flatMatches = hargaKain.filter((r) => normKey(r.namaSupplier) === normKey(supplierName) && normKey(r.warna) === normKey(warna));
  // HargaKainPksRow tidak punya namaSupplier (cuma kodeSupplier) — jembatani lewat tabel flat;
  // kalau tidak ada match sama sekali di situ, coba anggap supplierName sendiri sebagai kode.
  const kodeCandidates = new Set<string>(flatMatches.map((r) => normKey(r.kodeSupplier)));
  if (kodeCandidates.size === 0) kodeCandidates.add(normKey(supplierName));
  const pks = hargaKainPks.filter((r) => {
    if (!kodeCandidates.has(normKey(r.kodeSupplier)) || normKey(r.warna) !== normKey(warna)) return false;
    const compareQty = normKey(r.satuan) === "TON" ? totalKg / 1000 : totalKg;
    return compareQty >= (r.tonaseMin ?? 0) && compareQty < (r.tonaseMax ?? Infinity);
  });
  if (pks.length > 0) {
    const best = pks.reduce((a, b) => ((b.tonaseMin ?? 0) > (a.tonaseMin ?? 0) ? b : a));
    return { rate: best.hargaPerKg, source: "PKS", totalKg, band: best };
  }
  if (flatMatches.length > 0) return { rate: flatMatches[0].hargaPerKg, source: "Standar", totalKg };
  return { rate: MATERIAL_RATE_PER_ROLL / 25, source: "Estimasi", totalKg };
}

export function hargaKainRate(hargaKain: HargaKainRow[], hargaKainPks: HargaKainPksRow[], supplierName: string, warna: string, totalKg: number): number {
  return hargaKainRateInfo(hargaKain, hargaKainPks, supplierName, warna, totalKg).rate;
}

function lenganAbbr(lengan: Lengan): string {
  return lengan === "PENDEK" ? "PDK" : "PJG";
}

/** Rincian per lengan kenapa PO Maklon dapat harga sekian — 1 baris teks per lengan (kalau PO
 *  campuran PDK+PJG, bisa beda sumber per lengan), plus daftar source-nya untuk badge ringkas
 *  (lihat summarizeRateSources). Dipakai di UI untuk tooltip/label "Standar"/"PKS" + alasannya. */
export function maklonRateExplanation(hargaMaklon: HargaMaklonRow[], vendorKey: string, aduanRows: AduanPolaRow[]): { sources: RateSource[]; lines: string[] } {
  const byLengan = new Map<Lengan, number>();
  for (const a of aduanRows) byLengan.set(a.lengan, (byLengan.get(a.lengan) ?? 0) + a.qty);
  const sources: RateSource[] = [];
  const lines: string[] = [];
  for (const [lengan, qty] of byLengan) {
    if (qty <= 0) continue;
    const info = hargaMaklonRateInfo(hargaMaklon, vendorKey, lengan, qty);
    sources.push(info.source);
    const l = lenganAbbr(lengan);
    if (info.source === "PKS" && info.band) {
      const max = info.band.kapasitasMax != null ? formatPcs(info.band.kapasitasMax) : "ke atas";
      lines.push(`${l}: kumulatif ${formatPcs(qty)} pcs — masuk tier PKS ${formatPcs(info.band.kapasitasMin ?? 0)}–${max} pcs → ${formatRupiah(info.rate)}/pc`);
    } else if (info.source === "Standar") {
      lines.push(`${l}: kumulatif ${formatPcs(qty)} pcs — belum capai tier PKS manapun, pakai Standar → ${formatRupiah(info.rate)}/pc`);
    } else {
      lines.push(`${l}: vendor tidak ada di Master Data Harga Maklon, pakai estimasi flat → ${formatRupiah(info.rate)}/pc`);
    }
  }
  return { sources, lines };
}

/** Sama seperti maklonRateExplanation tapi untuk PO Material — rincian per warna (tonase
 *  dijumlah lintas lengan, sama seperti materialAmountForPo). */
export function materialRateExplanation(hargaKain: HargaKainRow[], hargaKainPks: HargaKainPksRow[], supplierName: string, colorBreakdown: ColorBreakdown[]): { sources: RateSource[]; lines: string[] } {
  const kgByWarna = new Map<string, number>();
  for (const c of colorBreakdown) kgByWarna.set(c.warna, (kgByWarna.get(c.warna) ?? 0) + c.rollCount * 25);
  const sources: RateSource[] = [];
  const lines: string[] = [];
  for (const [warna, kg] of kgByWarna) {
    const info = hargaKainRateInfo(hargaKain, hargaKainPks, supplierName, warna, kg);
    sources.push(info.source);
    const tonLabel = (kg / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 });
    if (info.source === "PKS" && info.band) {
      const max = info.band.tonaseMax != null ? formatPcs(info.band.tonaseMax) : "ke atas";
      lines.push(`${warna}: total ${formatPcs(kg)} kg (≈${tonLabel} ton) — masuk tier PKS ${formatPcs(info.band.tonaseMin ?? 0)}–${max} ${info.band.satuan} → ${formatRupiah(info.rate)}/kg`);
    } else if (info.source === "Standar") {
      lines.push(`${warna}: total ${formatPcs(kg)} kg (≈${tonLabel} ton) — belum capai tonase PKS manapun, pakai harga Standar → ${formatRupiah(info.rate)}/kg`);
    } else {
      lines.push(`${warna}: supplier+warna tidak ada di Master Data Harga Kain, pakai estimasi flat → ${formatRupiah(info.rate)}/kg`);
    }
  }
  return { sources, lines };
}

/** Ringkasan badge dari daftar source (buat 1 PO bisa campuran per lengan/warna) — "Campuran"
 *  kalau bedanya lebih dari satu jenis sumber. */
export function summarizeRateSources(sources: RateSource[]): { label: string; tone: "success" | "info" | "warning" | "neutral" } {
  const uniq = Array.from(new Set(sources));
  if (uniq.length === 0) return { label: "—", tone: "neutral" };
  if (uniq.length > 1) return { label: "Campuran", tone: "warning" };
  const s = uniq[0];
  if (s === "PKS") return { label: "PKS", tone: "success" };
  if (s === "Standar") return { label: "Standar", tone: "info" };
  return { label: "Estimasi", tone: "warning" };
}

/** Orkestrasi Maklon: buckets sudah dikelompokkan per lengan (kumulatif qty PER LENGAN dalam
 *  satu MRP/pemanggilan ini saja — BUKAN akumulasi lifetime lintas PO lain, lihat catatan scope
 *  di lib/mrp/masterData.ts), jumlahkan amount tiap bucket pakai rate masing-masing. */
export function maklonAmountForLenganBuckets(hargaMaklon: HargaMaklonRow[], vendorKey: string, buckets: { lengan: Lengan; qty: number }[]): number {
  let total = 0;
  for (const b of buckets) if (b.qty > 0) total += b.qty * hargaMaklonRate(hargaMaklon, vendorKey, b.lengan, b.qty);
  return Math.round(total);
}

/** Sama seperti di atas tapi input-nya AduanPolaRow mentah (sudah difilter ke 1 vendor) — dipakai
 *  saat PO Maklon pertama kali dibuat (sendPoToFinance), yang punya breakdown lengan lengkap. */
export function maklonAmountForVendor(hargaMaklon: HargaMaklonRow[], vendorKey: string, aduanRows: AduanPolaRow[]): number {
  const byLengan = new Map<Lengan, number>();
  for (const a of aduanRows) byLengan.set(a.lengan, (byLengan.get(a.lengan) ?? 0) + a.qty);
  return maklonAmountForLenganBuckets(hargaMaklon, vendorKey, Array.from(byLengan.entries()).map(([lengan, qty]) => ({ lengan, qty })));
}

// CATATAN MIGRASI SUPABASE: dua fungsi di bawah ini (splitMaterialPoByEntitas &
// advanceMaklonToDeliveryIfFullyDone) DIPINDAH dari lib/mrp/store.ts (bukan ditulis ulang)
// supaya bisa dipakai bareng dari Server Action di lib/mrp/actions.ts, tanpa duplikasi
// logika bisnis. Satu-satunya perubahan: splitMaterialPoByEntitas dulu generate id baru
// lewat nextId() in-memory synchronous, sekarang id-nya HARUS sudah di-generate lebih
// dulu oleh pemanggil (lewat next_readable_id() di Postgres, yang async) dan dioper lewat
// parameter `newIds` (urut sesuai grup entitas ke-2, ke-3, dst — grup pertama pakai id PO asal).
export function splitMaterialPoByEntitas(po: MaterialPO, newIds: string[]): MaterialPO[] {
  const groups = new Map<string, ColorBreakdown[]>();
  for (const c of po.colorBreakdown) {
    const ent = c.entitas ?? po.entity;
    groups.set(ent, [...(groups.get(ent) ?? []), c]);
  }
  if (groups.size <= 1) return [po];
  // Sisa (remainder) dari pembulatan dilempar ke grup TERAKHIR — bukan Math.round independen per
  // grup — supaya total amount hasil split selalu PERSIS sama dengan po.amount asli.
  const entries = Array.from(groups.entries());
  let amountRemaining = po.amount;
  let idCursor = 0;
  return entries.map(([entitas, colorBreakdown], idx) => {
    const rollCount = colorBreakdown.reduce((a, c) => a + c.rollCount, 0);
    const ratio = po.rollCount > 0 ? rollCount / po.rollCount : 0;
    const invoicedByColor: Record<string, number> = {};
    for (const c of colorBreakdown) {
      const key = c.warna + "|" + c.lengan;
      if (po.invoicedByColor[key] != null) invoicedByColor[key] = po.invoicedByColor[key];
    }
    const invoicedRolls = colorBreakdown.reduce((a, c) => a + (invoicedByColor[c.warna + "|" + c.lengan] ?? 0), 0);
    const isLast = idx === entries.length - 1;
    const amount = isLast ? amountRemaining : Math.round(po.amount * ratio);
    amountRemaining -= amount;
    return {
      ...po,
      id: idx === 0 ? po.id : newIds[idCursor++],
      warna: colorBreakdown.length === 1 ? colorBreakdown[0].warna : colorBreakdown.map((c) => c.warna).join(", "),
      lengan: colorBreakdown[0].lengan,
      colorBreakdown,
      invoicedByColor,
      rollCount,
      availableRolls: rollCount,
      invoicedRolls,
      amount,
      entity: entitas,
    };
  });
}

/** Pindahkan `moveQtyRoll` roll aduan pola (warna+lengan tertentu, milik fromVendor) ke toVendor
 *  -- dipakai transferMaterial. Row yang qty roll-nya lebih besar dari yang perlu dipindah
 *  di-SPLIT jadi 2 (sisa tetap di fromVendor, potongan pindah ke toVendor). `newIds` = id
 *  pre-generated (next_readable_id "AD") buat baris hasil split, dikonsumsi berurutan. */
export function reassignAduanRowsVendor(rows: AduanPolaRow[], fromVendor: string, toVendor: string, warna: string, lengan: Lengan, moveQtyRoll: number, newIds: string[]): AduanPolaRow[] {
  let remaining = moveQtyRoll;
  let idCursor = 0;
  const next: AduanPolaRow[] = [];
  for (const row of rows) {
    if (remaining <= 0 || row.vendor !== fromVendor || row.warna !== warna || row.lengan !== lengan) {
      next.push(row);
      continue;
    }
    if (row.qtyRoll <= remaining) {
      next.push({ ...row, vendor: toVendor });
      remaining -= row.qtyRoll;
    } else {
      const moveFrac = remaining / row.qtyRoll;
      const movedQty = Math.round(row.qty * moveFrac);
      next.push({ ...row, qtyRoll: row.qtyRoll - remaining, qty: row.qty - movedQty });
      next.push({ ...row, id: newIds[idCursor++], qtyRoll: remaining, qty: movedQty, vendor: toVendor });
      remaining = 0;
    }
  }
  return next;
}

/** Auto-advance status PO maklon dari PRODUCTION ke DELIVERY begitu semua target Finish Good
 *  tercapai. Dipanggil setelah tiap kali hasil produksi (FG) baru dicatat. */
export function advanceMaklonToDeliveryIfFullyDone(
  mrpId: string,
  vendorProduksi: string,
  maklonPOs: MaklonPO[],
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  results: ProductionResult[]
): MaklonPO[] {
  const po = maklonPOs.find((m) => m.mrpId === mrpId && m.vendorProduksi === vendorProduksi);
  if (!po || po.status !== "PRODUCTION") return maklonPOs;
  if (!maklonProductionFullyDone(mrpId, vendorProduksi, mrpDetails, batches, results)) return maklonPOs;
  return maklonPOs.map((m) => (m.id === po.id ? { ...m, status: "DELIVERY" } : m));
}

/** Orkestrasi Material: tonase dihitung SEKALI per warna (dijumlah lintas lengan dalam PO yang
 *  sama supplier-nya — 1 roll kain fisik warna X harganya sama mau nanti dipotong PENDEK atau
 *  PANJANG), rate hasil lookup itu baru diterapkan ke kontribusi rollCount×25kg tiap baris
 *  colorBreakdown untuk dijumlah jadi total amount PO. */
export function materialAmountForPo(hargaKain: HargaKainRow[], hargaKainPks: HargaKainPksRow[], supplierName: string, colorBreakdown: ColorBreakdown[]): number {
  const kgByWarna = new Map<string, number>();
  for (const c of colorBreakdown) kgByWarna.set(c.warna, (kgByWarna.get(c.warna) ?? 0) + c.rollCount * ROLL_KG_ESTIMATE);
  const rateByWarna = new Map<string, number>();
  for (const [warna, kg] of kgByWarna) rateByWarna.set(warna, hargaKainRate(hargaKain, hargaKainPks, supplierName, warna, kg));
  let total = 0;
  for (const c of colorBreakdown) total += c.rollCount * ROLL_KG_ESTIMATE * (rateByWarna.get(c.warna) ?? 0);
  return Math.round(total);
}

export type VendorProduksiRow = {
  vendor: string;
  name: string;
  qty: number;
  /** Kapasitas produksi PER MINGGU vendor ini (sumber: vendorProduksiList, lihat di bawah) --
   *  ditambahkan di sini (revisi 2026-09-06) supaya UI pemanggil tidak perlu lookup terpisah lagi
   *  ke VENDOR_PRODUKSI/vendorProduksiList sendiri (lihat app/procurement/po-approval/page.tsx). */
  baseCapacity: number;
  capacityPct: number;
  fee: number;
  estDays: number;
};

/** Revisi 2026-09-06: `name`+`baseCapacity` sekarang dari `vendorProduksiList` (data ASLI dari
 *  spreadsheet Procurement, lihat migration 0019_vendor_kapasitas_asli.sql & masterData.ts) --
 *  BUKAN lagi dari VENDOR_PRODUKSI (seed.ts), yang untuk 8 dari 10 vendor cuma placeholder.
 *  `estDays` TETAP dari VENDOR_PRODUKSI (belum diminta pindah ke DB). Fallback ke VENDOR_PRODUKSI
 *  murni jaga-jaga kalau baris DB entah kenapa belum ke-load (snapshot masih kosong saat render
 *  pertama) -- BUKAN sumber utama lagi. */
export function vendorProduksiRows(detail: MrpDetail, hargaMaklon: HargaMaklonRow[], vendorProduksiList: VendorProduksiMasterRow[]): VendorProduksiRow[] {
  const rowsByVendor = new Map<string, AduanPolaRow[]>();
  for (const a of detail.aduanRows) {
    const arr = rowsByVendor.get(a.vendor) ?? [];
    arr.push(a);
    rowsByVendor.set(a.vendor, arr);
  }
  return Array.from(rowsByVendor.entries()).map(([vendor, rows]) => {
    const dbMeta = vendorProduksiList.find((v) => v.id === vendor);
    const name = dbMeta?.name ?? VENDOR_PRODUKSI[vendor]?.name ?? vendor;
    const baseCapacity = dbMeta?.weeklyCapacity || VENDOR_PRODUKSI[vendor]?.baseCapacity || 5000;
    const estDays = VENDOR_PRODUKSI[vendor]?.estDays ?? 12;
    const qty = rows.reduce((s, r) => s + r.qty, 0);
    return {
      vendor,
      name,
      qty,
      baseCapacity,
      capacityPct: Math.min(100, Math.round((qty / baseCapacity) * 100)),
      // Fase 2: sama seperti sendPoToFinance — lookup bertingkat Master Data > Harga Maklon,
      // bukan flat ratePerPc lagi, supaya preview "Est. Biaya" ini sama persis dengan PO yang
      // benar-benar dibuat nanti (lihat maklonAmountForVendor).
      fee: maklonAmountForVendor(hargaMaklon, vendor, rows),
      estDays,
    };
  });
}

export function vendorsForMrp(detail: MrpDetail | undefined): string[] {
  if (!detail) return [];
  const fromAduan = detail.aduanRows.map((a) => a.vendor);
  const fromDefault = detail.lenganGroups.map((g) => g.vendorDefault);
  return Array.from(new Set([...fromAduan, ...fromDefault])).filter(Boolean);
}

export type MrpWarnaBreakdown = {
  warna: string;
  qtyPanjang: number;
  qtyPendek: number;
  qtyTotal: number;
  rollPanjang: number;
  rollPendek: number;
  rollTotal: number;
  ribPanjang: number;
  ribPendek: number;
  ribTotal: number;
};

/** Rincian per warna (qty/roll/rib, dipecah PANJANG vs PENDEK + total) untuk detail baris MRP di
 *  halaman PPIC — bersumber langsung dari lenganGroups (hasil sheet "MRP Template" saat import),
 *  bukan dari aduanRows/materialPOs, supaya tetap menampilkan rincian asli MRP walau sebagian
 *  sudah di-switch vendor/dibatalkan Procurement setelahnya. */
export function mrpWarnaBreakdown(detail: MrpDetail | undefined): MrpWarnaBreakdown[] {
  if (!detail) return [];
  const map = new Map<string, MrpWarnaBreakdown>();
  for (const g of detail.lenganGroups) {
    const cur = map.get(g.warna) ?? {
      warna: g.warna,
      qtyPanjang: 0,
      qtyPendek: 0,
      qtyTotal: 0,
      rollPanjang: 0,
      rollPendek: 0,
      rollTotal: 0,
      ribPanjang: 0,
      ribPendek: 0,
      ribTotal: 0,
    };
    if (g.lengan === "PANJANG") {
      cur.qtyPanjang += g.totalQty;
      cur.rollPanjang += g.rollEstimate;
      cur.ribPanjang += g.ribKg;
    } else {
      cur.qtyPendek += g.totalQty;
      cur.rollPendek += g.rollEstimate;
      cur.ribPendek += g.ribKg;
    }
    cur.qtyTotal += g.totalQty;
    cur.rollTotal += g.rollEstimate;
    cur.ribTotal += g.ribKg;
    map.set(g.warna, cur);
  }
  return Array.from(map.values());
}

export type MaklonPoWarnaBreakdown = { warna: string; lengan: Lengan; qty: number; qtyRoll: number };

/** Rincian per warna/lengan (qty pcs & estimasi roll) untuk SATU PO Produksi (mrpId+vendor) --
 *  item revisi 2026-09-06: Finance minta bisa klik baris PO Maklon untuk lihat detail, sama
 *  seperti PPIC/SCM (lihat mrpWarnaBreakdown di atas), tapi MaklonPO sendiri tidak punya
 *  colorBreakdown (beda dari MaterialPO) -- di-derive dari aduanRows MRP ini yang vendor-nya
 *  cocok, karena itu satu-satunya sumber "warna apa saja & berapa qty yang jadi tanggung jawab
 *  vendor produksi ini". */
export function maklonPoWarnaBreakdown(detail: MrpDetail | undefined, vendorId: string): MaklonPoWarnaBreakdown[] {
  if (!detail) return [];
  const map = new Map<string, MaklonPoWarnaBreakdown>();
  for (const a of detail.aduanRows) {
    if (a.vendor !== vendorId) continue;
    const key = a.warna + "|" + a.lengan;
    const cur = map.get(key) ?? { warna: a.warna, lengan: a.lengan, qty: 0, qtyRoll: 0 };
    cur.qty += a.qty;
    cur.qtyRoll += a.qtyRoll;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

export function effectiveMrpQty(mrpId: string, fallbackQty: number, maklonPOs: MaklonPO[]): number {
  const related = maklonPOs.filter((p) => p.mrpId === mrpId);
  if (related.length === 0) return fallbackQty;
  return related.reduce((s, p) => s + p.qty, 0);
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function aduanRowsForVendor(detail: MrpDetail, vendor: string): (AduanPolaRow & { movable: boolean })[] {
  const rows = detail.aduanRows.filter((a) => a.vendor === vendor);
  return rows.map((a) => ({ ...a, movable: true }));
}

export function mrpDetailFor(mrpId: string, mrpDetails: MrpDetail[]): MrpDetail | undefined {
  return mrpDetails.find((d) => d.mrp.id === mrpId);
}

export function ribKgPerRollForGroup(group: LenganGroup): number {
  return group.rollEstimate > 0 ? group.ribKg / group.rollEstimate : 0;
}

export type RibAllocation = { aduanRowId: string; rollUsed: number; ribKg: number };

export function aduanRibAllocationPreview(
  mrpId: string,
  warna: string,
  rollQty: number,
  mrpDetails: MrpDetail[]
): { totalRibKg: number; allocations: RibAllocation[] } {
  const detail = mrpDetailFor(mrpId, mrpDetails);
  if (!detail || rollQty <= 0) return { totalRibKg: 0, allocations: [] };
  let remainingQty = rollQty;
  const allocations: RibAllocation[] = [];
  for (const a of detail.aduanRows) {
    if (remainingQty <= 0) break;
    if (a.warna !== warna) continue;
    const avail = a.qtyRoll - (a.ribAllocatedRoll ?? 0);
    if (avail <= 0) continue;
    const use = Math.min(avail, remainingQty);
    const group = detail.lenganGroups.find((g) => g.id === a.lenganGroupId);
    const perRoll = group ? ribKgPerRollForGroup(group) : 0;
    allocations.push({ aduanRowId: a.id, rollUsed: use, ribKg: perRoll * use });
    remainingQty -= use;
  }
  const totalRibKg = allocations.reduce((s, a) => s + a.ribKg, 0);
  return { totalRibKg, allocations };
}

function earliest(dates: (string | undefined)[]): string | undefined {
  const vals = dates.filter((d): d is string => !!d).sort();
  return vals[0];
}

export function poInvoiceDates(poId: string, invoices: RawMaterialInvoice[]) {
  const mine = invoices.filter((i) => i.poId === poId);
  return {
    tglInvoice: earliest(mine.map((i) => i.bookedAt)),
    tglPayment: earliest(mine.filter((i) => i.paidAt).map((i) => i.paidAt)),
    tglPenerimaan: earliest(mine.filter((i) => i.receivedAt).map((i) => i.receivedAt)),
  };
}

export function maklonFeeForColorLine(po: MaterialPO, entry: ColorBreakdown, maklonPOs: MaklonPO[], mrpDetails: MrpDetail[]): number {
  const maklon = maklonPOs.find((m) => m.mrpId === po.mrpId && m.vendorProduksi === po.vendorProduksi);
  if (!maklon) return 0;
  const detail = mrpDetailFor(po.mrpId, mrpDetails);
  if (!detail) return 0;
  const totalVendorQty = detail.aduanRows.filter((a) => a.vendor === po.vendorProduksi).reduce((s, a) => s + a.qty, 0);
  const lineQty = detail.aduanRows
    .filter((a) => a.vendor === po.vendorProduksi && a.warna === entry.warna && a.lengan === entry.lengan)
    .reduce((s, a) => s + a.qty, 0);
  return totalVendorQty > 0 ? maklon.amount * (lineQty / totalVendorQty) : 0;
}

export function formatDecimal(n: number, decimals = 2): string {
  return n.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const RAW_MATERIAL_LABEL: Record<string, string> = {
  BELUM_MULAI: "BELUM MULAI",
  WAITING_INVOICE: "WAITING INVOICE",
  INVOICED: "INVOICED",
  PAID: "PAID",
  DELIVERY: "DELIVERY",
  RECEIVING: "RECEIVING",
  WAITING_PRODUCTION: "WAITING PRODUCTION",
  PRODUCTION_DONE: "PRODUCTION DONE",
};

const PRODUKSI_LABEL: Record<string, string> = {
  FULL_WAITING_MATERIAL: "WAITING MATERIAL",
  PARTIAL_WAITING_MATERIAL: "PARTIAL WAITING MATERIAL",
  PRODUCTION: "PRODUCTION",
  PARTIAL_PRODUCTION: "PARTIAL PRODUCTION",
  DELIVERY: "DELIVERY",
  INVOICE: "INVOICE",
  PAID: "PAID",
  FULLY_PAID: "FULLY PAID",
};

/** Tone StatusPill untuk label status ringkasan MRP (statusPO/statusRawMaterial/statusProduksi
 *  dari mrpStatusBadges) — dipakai halaman MRP PPIC & Monitoring SCM supaya warnanya konsisten
 *  di kedua tempat. */
export function mrpStatusBadgeTone(label: string): "neutral" | "info" | "success" | "warning" {
  if (label.includes("APPROVED") || label.includes("PAID") || label === "PRODUCTION DONE" || label === "SELESAI") return "success";
  if (label === "DRAFT" || label === "BELUM MULAI") return "neutral";
  if (label.includes("WAITING") || label === "PARTIAL PRODUCTION") return "warning";
  return "info";
}

export function mrpStatusBadges(
  mrpId: string,
  detail: MrpDetail | undefined,
  materialPOs: MaterialPO[],
  maklonPOs: MaklonPO[],
  invoices: RawMaterialInvoice[],
  vendorInvoices: VendorInvoice[]
) {
  const myMaterialPOs = materialPOs.filter((p) => p.mrpId === mrpId);
  const myMaklonPOs = maklonPOs.filter((p) => p.mrpId === mrpId);
  const myInvoices = invoices.filter((i) => myMaterialPOs.some((p) => p.id === i.poId));

  let statusPO = "DRAFT";
  if (detail?.poSent) {
    const allApproved = myMaterialPOs.length > 0 && myMaterialPOs.every((p) => p.approved || p.status === "CANCELLED") && myMaklonPOs.every((p) => p.approved);
    statusPO = allApproved ? "PO APPROVED" : "PO SENT";
  }

  let statusRawMaterial = "BELUM MULAI";
  const invOrder = ["INVOICED", "PAID", "DELIVERY", "RECEIVING", "WAITING_PRODUCTION", "PRODUCTION_DONE"];
  const bestInv = myInvoices.reduce<string | null>((best, i) => {
    if (!best) return i.status;
    return invOrder.indexOf(i.status) > invOrder.indexOf(best) ? i.status : best;
  }, null);
  if (bestInv) statusRawMaterial = RAW_MATERIAL_LABEL[bestInv];
  else if (myMaterialPOs.some((p) => p.approved)) statusRawMaterial = "WAITING INVOICE";

  let statusProduksi = "BELUM MULAI";
  const prodOrder = ["FULL_WAITING_MATERIAL", "PARTIAL_WAITING_MATERIAL", "PARTIAL_PRODUCTION", "PRODUCTION", "DELIVERY", "INVOICE", "PAID", "FULLY_PAID"];
  // maklonPoDisplayStatus, BUKAN p.status mentah — p.status berhenti maju di DELIVERY selamanya
  // begitu billing pindah ke jalur VendorInvoice baru (lihat catatan panjang di
  // maklonPoDisplayStatus). Bug ini sudah kejadian 4x di halaman lain (PO Produksi vendor,
  // Monitoring Produksi, PO Approval Procurement, PO Maklon Finance) — halaman ini (dipakai PPIC &
  // SCM Monitoring) kelewatan waktu itu karena mrpStatusBadges belum menerima vendorInvoices sama
  // sekali.
  const bestProd = myMaklonPOs.reduce<string | null>((best, p) => {
    const status = maklonPoDisplayStatus(p, vendorInvoices);
    if (!best) return status;
    return prodOrder.indexOf(status) > prodOrder.indexOf(best) ? status : best;
  }, null);
  if (bestProd) statusProduksi = PRODUKSI_LABEL[bestProd];

  return { statusPO, statusRawMaterial, statusProduksi };
}

export function materialPoBadge(status: MaterialPO["status"]) {
  const map: Record<MaterialPO["status"], { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" | "rework" }> = {
    WAITING_INVOICE: { label: "WAITING INVOICE", tone: "warning" },
    INVOICE: { label: "INVOICE", tone: "info" },
    PAYMENT: { label: "PAYMENT", tone: "info" },
    DELIVERY_MATERIAL: { label: "DELIVERY MATERIAL", tone: "info" },
    PROSES_PRODUKSI: { label: "PROSES PRODUKSI", tone: "rework" },
    CANCELLED: { label: "CANCELLED", tone: "neutral" },
  };
  return map[status];
}

export type MaterialPoFullStatus =
  | "WAITING_APPROVAL"
  | "WAITING_INVOICE"
  | "WAITING_INVOICE_PARTIAL"
  | "INVOICE"
  | "PAID"
  | "CANCEL"
  | "DELIVERY"
  | "RECEIVING"
  | "PRODUCTION"
  | "FINISH_GOOD"
  | "DELIVERED_FROM_VENDOR"
  | "SELESAI";

/** Status gabungan 1 PO material dari awal (approval) sampai BENAR-BENAR selesai — dulu berhenti
 *  di FINISH_GOOD (target Finish Good tercapai), padahal itu belum berarti barangnya sudah
 *  keluar dari vendor produksi ATAU vendor produksinya sudah dibayar lunas. Sekarang lanjut ke:
 *  - DELIVERED_FROM_VENDOR: FG untuk MRP+vendor produksi ini sudah ada koli yang `deliveredAt`
 *    (lihat createDeliveryKoli/markKoliDelivered di store.ts) — barang sudah keluar dari vendor.
 *  - SELESAI: DAN invoice vendor (maklon) untuk MRP+vendor itu sudah lunas (retensi+tahap1
 *    terbayar, lihat vendorInvoicePaymentStatus) — baru dianggap benar-benar tuntas end-to-end. */
export function materialPoFullStatus(
  po: MaterialPO,
  invoices: RawMaterialInvoice[],
  productionBatches: ProductionBatch[] = [],
  productionResults: ProductionResult[] = [],
  mrpDetails: MrpDetail[] = [],
  deliveryKolis: DeliveryKoli[] = [],
  vendorInvoices: VendorInvoice[] = [],
  maklonPOs: MaklonPO[] = []
): MaterialPoFullStatus {
  if (po.status === "CANCELLED") return "CANCEL";
  if (!po.approved) return "WAITING_APPROVAL";
  if (po.invoicedRolls === 0) return "WAITING_INVOICE";
  if (po.invoicedRolls < po.rollCount) return "WAITING_INVOICE_PARTIAL";

  const rank = ["INVOICED", "PAID", "DELIVERY", "RECEIVING", "WAITING_PRODUCTION", "PRODUCTION_DONE"];
  let bestIdx = -1;
  for (const inv of invoices) {
    if (inv.poId !== po.id) continue;
    const idx = rank.indexOf(inv.status);
    if (idx > bestIdx) bestIdx = idx;
  }
  const bestStatus = bestIdx >= 0 ? rank[bestIdx] : "INVOICED";

  // INVOICED (sudah dibuatkan Paying Voucher, belum dibayar Finance) dan PAID (sudah dibayar)
  // dulu digabung jadi satu label "INVOICE" -- Finance klik "Bayar" tidak kelihatan bedanya sama
  // sekali di Material Tracking. Sekarang dipisah jadi 2 status.
  if (bestStatus === "INVOICED") return "INVOICE";
  if (bestStatus === "PAID") return "PAID";
  if (bestStatus === "DELIVERY") return "DELIVERY";

  // "Sudah mulai produksi" sekarang juga dianggap benar begitu vendor klik "Mulai Produksi" di
  // portalnya (MaklonPO.status jadi PRODUCTION/PARTIAL_PRODUCTION lewat advanceMaklonProductionAction,
  // dipanggil dari Good Receive) -- TIDAK cuma menunggu roll benar-benar di-cutting. Dulu status di
  // sini nyangkut di RECEIVING walau vendor sudah kelihatan "sedang produksi" di portalnya sendiri,
  // bikin Procurement/Finance yang cuma lihat Material Tracking mengira belum ada progres apa-apa.
  const vendorStartedProduction = maklonPOs.some(
    (m) => m.mrpId === po.mrpId && m.vendorProduksi === po.vendorProduksi && (m.status === "PRODUCTION" || m.status === "PARTIAL_PRODUCTION")
  );
  const startedProduction =
    vendorStartedProduction ||
    po.colorBreakdown.some((c) => productionBatches.some((b) => b.mrpId === po.mrpId && b.warna === c.warna && b.lengan === c.lengan && b.cuttingAt));
  if (!startedProduction) return "RECEIVING";

  const finished = po.colorBreakdown.every((c) => {
    const target = targetSizesForGroup(po.mrpId, c.warna, c.lengan, mrpDetails, productionBatches);
    const targetTotal = Object.values(target).reduce((a, b) => a + b, 0);
    if (targetTotal <= 0) return false;
    const groupKey = po.mrpId + "|" + c.warna + "|" + c.lengan;
    const fgTotal = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", productionResults)).reduce((a, b) => a + b, 0);
    return fgTotal >= targetTotal;
  });
  if (!finished) return "PRODUCTION";

  const delivered = deliveryKolis.some((k) => k.mrpId === po.mrpId && k.vendorProduksi === po.vendorProduksi && k.deliveredAt);
  if (!delivered) return "FINISH_GOOD";

  const vendorFullyPaid = vendorInvoices.some((vi) => vi.vendorProduksi === po.vendorProduksi && vi.lines.some((l) => l.mrpId === po.mrpId) && vi.status === "PAID");
  return vendorFullyPaid ? "SELESAI" : "DELIVERED_FROM_VENDOR";
}

export function materialPoFullStatusBadge(status: MaterialPoFullStatus) {
  const map: Record<MaterialPoFullStatus, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" | "rework" | "active" | "locked" | "done" }> = {
    WAITING_APPROVAL: { label: "WAITING APPROVAL", tone: "warning" },
    WAITING_INVOICE: { label: "WAITING INVOICE", tone: "neutral" },
    WAITING_INVOICE_PARTIAL: { label: "WAITING INVOICE PARTIAL", tone: "rework" },
    INVOICE: { label: "INVOICE", tone: "info" },
    PAID: { label: "PAID", tone: "success" },
    CANCEL: { label: "CANCEL", tone: "danger" },
    DELIVERY: { label: "DELIVERY", tone: "active" },
    RECEIVING: { label: "RECEIVING", tone: "rework" },
    PRODUCTION: { label: "PRODUCTION", tone: "locked" },
    FINISH_GOOD: { label: "FINISH GOOD", tone: "success" },
    DELIVERED_FROM_VENDOR: { label: "DELIVERED DARI VENDOR", tone: "active" },
    SELESAI: { label: "SELESAI — LUNAS", tone: "done" },
  };
  return map[status];
}

export function ekspedisiPrice(ekspedisi: string, beratKg: number): number {
  const brackets = EKSPEDISI_RATES.filter((r) => r.ekspedisi === ekspedisi);
  if (brackets.length === 0) return 0;
  const match = brackets.find((r) => beratKg >= r.minKg && beratKg < r.maxKg) ?? brackets[brackets.length - 1];
  return Math.round(match.pricePerKg * beratKg);
}

/** Status approval SCM untuk MRP yang diajukan PPIC — gerbang sebelum Procurement bisa bikin PO
 *  (lihat selectable di app/procurement/po-approval/page.tsx). Dipakai di halaman PPIC (kolom
 *  "Status SCM"), halaman approval & monitoring SCM. */
export function ppicApprovalBadge(status: PpicApprovalStatus): { label: string; tone: "neutral" | "warning" | "success" | "danger" } {
  const map: Record<PpicApprovalStatus, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
    DRAFT: { label: "DRAFT", tone: "neutral" },
    WAITING_PPIC_APPROVAL: { label: "MENUNGGU APPROVAL SCM", tone: "warning" },
    PPIC_APPROVED: { label: "DISETUJUI SCM", tone: "success" },
    REJECTED: { label: "DITOLAK SCM", tone: "danger" },
  };
  return map[status];
}

export function maklonPoBadge(po: Pick<MaklonPO, "status" | "qty">) {
  // qty bisa turun ke 0 lewat transferMaterial/closePoWithReason (seluruh material dipindahkan
  // ke vendor lain) — status ASLI (mis. FULL_WAITING_MATERIAL) sengaja dipertahankan sebagai
  // histori di store (lihat transferMaterial di store.ts), tapi kalau ditampilkan apa adanya di
  // tabel jadi menyesatkan: PO Vendor Produksi dengan qty 0 seolah masih ada kerjaan pending,
  // padahal materialnya sudah sepenuhnya dialihkan. Override LABEL TAMPILAN saja di sini (bukan
  // status yang tersimpan) begitu qty sudah 0, supaya baris cancelledLines/histori tetap utuh.
  if (po.qty === 0) return { label: "DIPINDAHKAN — QTY KOSONG", tone: "neutral" as const };
  const map: Record<MaklonPO["status"], { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
    FULL_WAITING_MATERIAL: { label: "WAITING MATERIAL", tone: "warning" },
    PARTIAL_WAITING_MATERIAL: { label: "PARTIAL WAITING MATERIAL", tone: "warning" },
    PRODUCTION: { label: "PRODUCTION", tone: "info" },
    PARTIAL_PRODUCTION: { label: "PARTIAL PRODUCTION", tone: "info" },
    DELIVERY: { label: "DELIVERY", tone: "info" },
    INVOICE: { label: "INVOICE", tone: "warning" },
    PAID: { label: "PAID", tone: "success" },
    FULLY_PAID: { label: "FULLY PAID", tone: "success" },
  };
  return map[po.status];
}

/** Status "logis" 1 PO Maklon buat ditampilkan — `po.status` MENTAH sekarang berhenti maju di
 *  DELIVERY selamanya: jalur billing LAMA (`submitMaklonInvoice`, per-PO) yang dulu memajukan
 *  status ini ke INVOICE/PAID/FULLY_PAID sudah di-deprecate jadi no-op (lihat catatan di
 *  lib/mrp/store.ts), sementara jalur BARU (`createVendorInvoice`/`payVendorInvoice`, per-pcs via
 *  `VendorInvoice`) tidak pernah menyentuh field `MaklonPO.status` sama sekali. Efeknya: PO yang
 *  sudah full diinvoice + dibayar lunas lewat Invoice Vendor tetap kelihatan "DELIVERY" selamanya
 *  di halaman manapun yang baca `po.status` mentah — padahal Finance/Procurement sudah benar
 *  nampilin "Lunas"/"PAID" di panel invoice vendor-nya sendiri (`VendorInvoice`, lihat
 *  vendorInvoicePaymentStatus). Fungsi ini menyatukan keduanya supaya SEMUA halaman yang nampilin
 *  status PO Maklon (PO Produksi Saya vendor, Monitoring Produksi, PO Approval Procurement, PO
 *  Maklon Finance) konsisten dengan status invoice yang sesungguhnya — bukan cuma di panel
 *  invoice itu sendiri. Status produksi (WAITING_MATERIAL..PRODUCTION) apa adanya (masih akurat,
 *  masih di-drive advanceMaklonProduction); begitu sampai DELIVERY, dicek lagi ke VendorInvoice
 *  yang match mrpId+vendorProduksi buat tahu sejauh mana proses invoice-nya. */
export function maklonPoDisplayStatus(po: Pick<MaklonPO, "mrpId" | "vendorProduksi" | "status">, vendorInvoices: VendorInvoice[]): MaklonPO["status"] {
  if (po.status !== "DELIVERY") return po.status;
  const related = vendorInvoices.filter((inv) => inv.vendorProduksi === po.vendorProduksi && inv.lines.some((l) => l.mrpId === po.mrpId));
  if (related.length === 0) return "DELIVERY";
  if (related.every((inv) => inv.status === "PAID")) return "FULLY_PAID";
  return "INVOICE"; // SUBMITTED/REVISION/APPROVED — sudah diajukan, masih dalam proses review/pembayaran Finance.
}

/** Badge status PO Maklon yang BENAR-BENAR bedain "menunggu approval Finance" dari "sudah
 *  di-approve, tinggal menunggu material/produksi" — `maklonPoBadge`/`maklonPoDisplayStatus`
 *  murni baca `status` (FULL_WAITING_MATERIAL dst), yang TIDAK berubah begitu di-approve (lihat
 *  approveMaklonPoAction, cuma flip `approved`, status produksi dipertahankan apa adanya).
 *  Sebelumnya label FULL_WAITING_MATERIAL sempat diganti jadi "WAITING APPROVAL" langsung (atas
 *  permintaan awal), tapi itu jadi SELALU nyangkut di situ walau PO sudah di-approve dan
 *  materialnya sudah di-set delivery segala macam — membingungkan (lihat feedback: "approval
 *  darimana? padahal sudah diset delivery"). Sekarang: cuma tampilkan "WAITING APPROVAL" kalau
 *  MEMANG `!po.approved`; begitu sudah di-approve, langsung ke status produksi asli
 *  (WAITING MATERIAL dst) dari maklonPoBadge seperti biasa. */
export function maklonPoBadgeWithApproval(po: Pick<MaklonPO, "mrpId" | "vendorProduksi" | "status" | "qty" | "approved">, vendorInvoices: VendorInvoice[]) {
  if (!po.approved) return { label: "WAITING APPROVAL", tone: "warning" as const };
  return maklonPoBadge({ ...po, status: maklonPoDisplayStatus(po, vendorInvoices) });
}

export function invoiceBadge(status: RawMaterialInvoice["status"]) {
  const map: Record<
    RawMaterialInvoice["status"],
    { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" | "rework" | "active" | "locked" | "done" }
  > = {
    WAITING_INVOICE: { label: "WAITING INVOICE", tone: "warning" },
    INVOICED: { label: "INVOICED", tone: "neutral" },
    PAID: { label: "PAID", tone: "info" },
    DELIVERY: { label: "DELIVERY", tone: "active" },
    RECEIVING: { label: "RECEIVING", tone: "rework" },
    WAITING_PRODUCTION: { label: "WAITING PRODUCTION", tone: "locked" },
    PRODUCTION_DONE: { label: "PRODUCTION DONE", tone: "success" },
  };
  return map[status];
}

export function maklonInvoiceBadge(status: MaklonInvoice["status"]) {
  const map: Record<MaklonInvoice["status"], { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" | "rework" }> = {
    SUBMITTED: { label: "SUBMITTED", tone: "warning" },
    APPROVED: { label: "APPROVED", tone: "info" },
    PAID: { label: "PAID", tone: "success" },
  };
  return map[status];
}

export function materialReceivedForMaklon(mrpId: string, vendorProduksi: string, invoices: RawMaterialInvoice[]): boolean {
  const receivedStages = ["RECEIVING", "WAITING_PRODUCTION", "PRODUCTION_DONE"];
  return invoices.some((i) => i.mrpId === mrpId && i.destinationVendor === vendorProduksi && receivedStages.includes(i.status));
}

export const WEIGHT_TOLERANCE_PCT = 2;

// Item 4 (feedback batch 2026-09-04): klaim cuma masuk akal kalau material datang LEBIH RINGAN
// dari yang diinvoice -- kalau lebih BERAT dari invoice, itu bukan kerugian, jadi tidak perlu
// diklaim (disimpan normal, roll tetap bisa dipakai). `withinTolerance` sengaja dipertahankan
// apa adanya (dua arah) supaya konsumen lama yang masih memakainya tidak berubah perilaku --
// `claimable` adalah field TAMBAHAN yang searah, dipakai buat gate klaim/roll-lock yang baru.
export function weightVariance(grossKg: number, netKg: number) {
  const diff = netKg - grossKg;
  const pct = grossKg > 0 ? (diff / grossKg) * 100 : 0;
  const withinTolerance = Math.abs(pct) <= WEIGHT_TOLERANCE_PCT;
  const claimable = !withinTolerance && diff < 0;
  return { diff, pct, withinTolerance, claimable };
}

export type MaterialClaimRow = {
  /** invoiceId+"|"+warna+"|"+lengan+"|"+rollIndex — stable id dipakai sebagai key resolusi
   *  klaim (lihat materialClaimResolutions di lib/mrp/store.ts). */
  key: string;
  invoiceId: string;
  poId: string;
  mrpId: string;
  supplier: string;
  vendorProduksi: string;
  warna: string;
  lengan: Lengan;
  rollIndex: number;
  codeRoll?: string;
  codeLot?: string;
  grossKg: number;
  netKg: number;
  diffKg: number;
  pct: number;
  receivedAt: string;
  /** Ada tidaknya foto bukti berat bersih (item 2/3) -- `!!receipt.claimPhotoAt`. Byte foto
   *  sendiri diambil terpisah lewat getMaterialClaimPhotoAction, tidak ada di sini. */
  hasPhoto: boolean;
};

/** Tahap alur retur klaim selisih berat — dipakai di halaman Procurement (Klaim Material) DAN
 *  di tab Cutting vendor (buat mengunci/membuka aksi timbang ulang roll yang diklaim, lihat
 *  production-cutting-tab.tsx). Satu sumber kebenaran supaya kedua sisi selalu sinkron:
 *  BELUM (baru terkirim, belum ada tindakan) -> RETUR_DIMINTA (Procurement sudah minta retur ke
 *  supplier) -> RETUR_DIKIRIM (Procurement tandai roll pengganti sudah dikirim) -> RETUR_DITERIMA
 *  (vendor konfirmasi terima fisik -- BARU di titik ini vendor boleh timbang ulang) -> SELESAI
 *  (ditutup manual tanpa retur, mis. diterima apa adanya) atau otomatis hilang dari
 *  materialClaimsList begitu roll ditimbang ulang & hasilnya sesuai toleransi. */
export type MaterialClaimStage = "BELUM" | "RETUR_DIMINTA" | "RETUR_DIKIRIM" | "RETUR_DITERIMA" | "SELESAI";

export function materialClaimStage(
  key: string,
  resolutions: Record<string, unknown>,
  returRequests: Record<string, unknown>,
  returDeliveries: Record<string, unknown>,
  returReceipts: Record<string, unknown>
): MaterialClaimStage {
  if (resolutions[key]) return "SELESAI";
  if (returReceipts[key]) return "RETUR_DITERIMA";
  if (returDeliveries[key]) return "RETUR_DIKIRIM";
  if (returRequests[key]) return "RETUR_DIMINTA";
  return "BELUM";
}

/** Daftar klaim selisih berat KURANG dari toleransi (item 4: cuma roll yang datang LEBIH RINGAN
 *  dari invoice yang diklaim, lihat `weightVariance().claimable`; lebih berat dari invoice bukan
 *  klaim) — diturunkan langsung dari `invoices` (gross per roll ada di `colorEntries[].rolls[idx]`,
 *  net ada di `rollReceipts`), bukan dari field tersendiri — setiap roll yang berhasil disimpan
 *  dengan selisih di luar toleransi & lebih ringan PASTI sudah lewat dialog "Kirim Claim" di Cutting
 *  vendor (lihat components/mrp/production-cutting-tab.tsx), jadi tidak butuh flag terpisah untuk
 *  tahu roll mana yang "diklaim". Dipakai halaman Procurement > Klaim Material. */
export function materialClaimsList(invoices: RawMaterialInvoice[]): MaterialClaimRow[] {
  const out: MaterialClaimRow[] = [];
  for (const inv of invoices) {
    for (const c of inv.colorEntries) {
      const colorKey = c.warna + "|" + c.lengan;
      const receipts = inv.rollReceipts[colorKey] ?? [];
      c.rolls.forEach((grossKg, idx) => {
        const receipt = receipts[idx];
        if (!receipt) return;
        const variance = weightVariance(grossKg, receipt.netKg);
        if (!variance.claimable) return;
        out.push({
          key: inv.id + "|" + colorKey + "|" + idx,
          invoiceId: inv.id,
          poId: inv.poId,
          mrpId: inv.mrpId,
          supplier: inv.supplier,
          vendorProduksi: inv.destinationVendor,
          warna: c.warna,
          lengan: c.lengan,
          rollIndex: idx,
          codeRoll: receipt.codeRoll,
          codeLot: receipt.codeLot,
          grossKg,
          netKg: receipt.netKg,
          diffKg: variance.diff,
          pct: variance.pct,
          receivedAt: receipt.receivedAt,
          hasPhoto: !!receipt.claimPhotoAt,
        });
      });
    }
  }
  return out.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

/** Revisi 2026-09-06: saldo deposit VENDOR (supplier) berjalan -- SUM(amount CREDIT) dikurangi
 *  SUM(amount DEBIT) untuk supplier itu. Sengaja dihitung LIVE dari seluruh baris ledger (bukan 1
 *  kolom running-total tersendiri) supaya tidak ada 2 sumber kebenaran saldo yang bisa selisih --
 *  lihat VendorDepositEntry di types.ts. */
export function vendorDepositBalance(supplier: string, entries: VendorDepositEntry[]): number {
  let balance = 0;
  for (const e of entries) {
    if (e.supplier !== supplier) continue;
    balance += e.kind === "CREDIT" ? e.amount : -e.amount;
  }
  return balance;
}

/** Rincian ledger saldo deposit 1 supplier, terurut TERBARU DULU -- dipakai untuk "Lihat rincian"
 *  di Payment (asal-usul saldo, bukan angka blackbox) & halaman Saldo Deposit Vendor. */
export function vendorDepositEntriesFor(supplier: string, entries: VendorDepositEntry[]): VendorDepositEntry[] {
  return entries.filter((e) => e.supplier === supplier).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Semua supplier yang punya minimal 1 baris ledger (aktif maupun saldo sudah 0 lagi karena habis
 *  dipakai) -- dipakai untuk daftar baris di halaman Saldo Deposit Vendor. */
export function vendorDepositSuppliers(entries: VendorDepositEntry[]): string[] {
  return Array.from(new Set(entries.map((e) => e.supplier)));
}

/** Aritmatika "retur + pesan ulang" (lihat createClaimReplacementInvoiceAction) -- helper kecil
 *  murni, dipakai untuk preview live di modal "Buat PV Pengganti" SEBELUM submit, supaya user
 *  paham konsekuensinya (kekurangan bayar vs jadi saldo deposit) sebelum klik. `kredit` = nilai
 *  retur (rate lama x berat lama, per warna/lengan/roll yang diretur -- BUKAN total PV lama).
 *  `selisih` positif berarti kekurangan yang ditagih, negatif berarti jadi saldo deposit. */
export function claimReplacementValue(rateBaru: number, beratBaruKg: number, rateLama: number, beratLamaKg: number): { nilaiBaru: number; kredit: number; selisih: number } {
  const nilaiBaru = rateBaru * beratBaruKg;
  const kredit = rateLama * beratLamaKg;
  return { nilaiBaru, kredit, selisih: nilaiBaru - kredit };
}

/** invoiceId asal dari 1 claim key ("invoiceId|warna|lengan|rollIndex", lihat materialClaimsList)
 *  -- dipakai untuk kolom "PO Reference (lama)" di payment-panel.tsx tanpa perlu parseClaimKey
 *  sisi server (yang juga butuh warna/lengan/rollIndex, di sini cukup invoiceId-nya saja). */
export function claimKeySourceInvoiceId(claimKey: string): string {
  return claimKey.split("|")[0] ?? claimKey;
}

/** Nilai kredit (CREDIT) yang tercatat di ledger saldo deposit untuk 1 claim key tertentu -- 0
 *  kalau belum ada (mis. ledger belum sempat ke-refresh). Dipakai di payment-panel.tsx untuk
 *  kolom "Pembayaran Sebelumnya" & "Selisih" pada invoice hasil klaim (RawMaterialInvoice.sourceClaimId). */
export function vendorDepositCreditForClaim(claimKey: string, entries: VendorDepositEntry[]): number {
  const entry = entries.find((e) => e.kind === "CREDIT" && e.sourceClaimId === claimKey);
  return entry?.amount ?? 0;
}

/** Item revisi 2026-09-07 (owner: "kenapa masih harus bayar dengan nilai pv terbaru? kan kita
 *  cuman harus bayar selisihnya saja"): sisa TAGIHAN RIIL 1 invoice, dikurangi DEBIT deposit yang
 *  SUDAH diterapkan langsung ke invoice ini (`source_invoice_id`) -- bukan `totalBiaya` mentah.
 *  Dipakai payment-panel.tsx untuk kotak "Bayar" supaya PV pengganti klaim yang kreditnya sudah
 *  otomatis diterapkan (lihat createClaimReplacementInvoiceAction) cuma minta SELISIHNYA, bukan
 *  nilai penuh PV baru. `totalBiaya` sendiri SENGAJA tidak diubah/dikurangi di manapun -- field itu
 *  tetap merepresentasikan nilai ASLI PV ini (dipakai Material Tracking, riwayat Paying Voucher,
 *  HPP, dst sebagai "nilai PV"), jadi netting-nya dihitung di sini secara terpisah, bukan menimpa
 *  data sumbernya.
 *
 *  Aman dipakai untuk SEMUA invoice (bukan cuma PV pengganti klaim): sebelum revisi ini, satu-
 *  satunya jalan bikin DEBIT `source_invoice_id` menunjuk ke invoice yang MASIH berstatus INVOICED
 *  (bukan langsung PAID di klik yang sama) adalah lewat jalur otomatis baru ini -- alur manual lama
 *  (applyVendorDepositAction lewat kotak "Saldo Deposit" Payment) SELALU dipanggil BARENGAN dengan
 *  setInvoicesPaid di klik "Bayar" yang sama, jadi invoice-nya langsung PAID juga, tidak pernah
 *  nyangkut INVOICED dengan DEBIT parsial. Makanya untuk invoice lama/biasa, hasilnya SELALU sama
 *  persis dengan totalBiaya (tidak ada regresi). */
export function outstandingAmountForInvoice(invoice: RawMaterialInvoice, entries: VendorDepositEntry[]): number {
  const applied = entries.filter((e) => e.kind === "DEBIT" && e.sourceInvoiceId === invoice.id).reduce((a, e) => a + e.amount, 0);
  return Math.max(0, invoice.totalBiaya - applied);
}

export function receivedRollCountForColor(mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan, invoices: RawMaterialInvoice[]): number {
  const key = warna + "|" + lengan;
  let count = 0;
  for (const i of invoices) {
    if (i.mrpId !== mrpId || i.destinationVendor !== vendorProduksi) continue;
    const receipts = i.rollReceipts[key] ?? [];
    count += receipts.filter((r) => r != null).length;
  }
  return count;
}

/** Sama dengan `receivedRollCountForColor`, TAPI cuma menghitung roll yang sudah punya
 *  `codeRoll` — dipakai khusus untuk "berapa roll yang BISA dipilih untuk cutting" (lihat
 *  `availableRollsForAduanRow`). Roll yang diterima tanpa codeRoll (field opsional saat Good
 *  Receive) tetap terhitung "sudah diterima" secara fisik oleh `receivedRollCountForColor` biasa
 *  (dipakai di funnel PO→Received→Cutting→FG→Delivery), tapi TIDAK BISA muncul di dropdown Code
 *  Roll saat mulai Resting (lihat `availableCodeRollsForColor`, yang men-skip roll tanpa
 *  codeRoll). Sebelum ada fungsi ini, "Total Roll Tersedia" di tab Produksi memakai hitungan yang
 *  tidak sinkron dengan itu — bisa menampilkan mis. 2 roll tersedia padahal cuma 1 yang punya
 *  code roll untuk dipilih, sehingga baris ke-2 yang ditambah user (dropdown code roll-nya kosong)
 *  gagal tersimpan diam-diam saat "Resting" diklik. */
function receivedRollCountWithCodeForColor(mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan, invoices: RawMaterialInvoice[]): number {
  const key = warna + "|" + lengan;
  let count = 0;
  for (const i of invoices) {
    if (i.mrpId !== mrpId || i.destinationVendor !== vendorProduksi) continue;
    const colorEntry = i.colorEntries.find((c) => c.warna === warna && c.lengan === lengan);
    const receipts = i.rollReceipts[key] ?? [];
    receipts.forEach((r, idx) => {
      if (!r || !r.codeRoll) return;
      // Roll dengan klaim selisih berat AKTIF (kurang dari toleransi & belum ditimbang ulang
      // sampai sesuai — lihat requestMaterialClaimRetur) sengaja TIDAK dihitung tersedia untuk
      // dipotong, supaya material bermasalah tidak terpakai produksi sebelum retur ke supplier
      // selesai. Item 4: cuma yang `claimable` (lebih RINGAN) yang mengunci — roll yang lebih
      // BERAT dari invoice tetap dihitung tersedia. Item 13: roll juga harus sudah "Konfirmasi"
      // (weighConfirmedAt) sebelum dihitung tersedia untuk Resting.
      const grossKg = colorEntry?.rolls[idx];
      if (grossKg !== undefined && weightVariance(grossKg, r.netKg).claimable) return;
      if (!r.weighConfirmedAt) return;
      count++;
    });
  }
  return count;
}

/** True kalau SEMUA roll (di semua warna/lengan) & semua add-buy dari invoice ini sudah
 *  ditimbang/diinput di Good Receive. `RawMaterialInvoice.status` sendiri TIDAK bisa dipakai
 *  untuk ini — status cuma berpindah dari DELIVERY ke RECEIVING sekali saat roll pertama
 *  diinput, lalu tidak pernah berubah lagi walau roll-roll berikutnya sudah lengkap semua. */
export function invoiceFullyReceived(inv: RawMaterialInvoice): boolean {
  const allRollsReceived = inv.colorEntries.every((c) => {
    const key = c.warna + "|" + c.lengan;
    const receipts = inv.rollReceipts[key] ?? [];
    return c.rolls.every((_, idx) => receipts[idx] != null);
  });
  const allAddBuysReceived = inv.addBuys.every((b) => inv.addBuyReceipts[b.id] != null);
  return allRollsReceived && allAddBuysReceived;
}

/** True kalau SEMUA roll invoice ini sudah ditandai diterima (fisik datang) di Good Receive —
 *  BELUM TENTU sudah ditimbang (lihat invoiceFullyReceived untuk itu; sekarang ditimbang di
 *  halaman Cutting). Dipakai buat badge sidebar Good Receive, yang sekarang cuma tanggung jawab
 *  "tandai diterima", bukan lagi menimbang. */
export function invoiceFullyArrived(inv: RawMaterialInvoice): boolean {
  const allRollsArrived = inv.colorEntries.every((c) => {
    const key = c.warna + "|" + c.lengan;
    const arrivals = inv.rollArrivals[key] ?? [];
    return c.rolls.every((_, idx) => arrivals[idx] != null);
  });
  const allAddBuysReceived = inv.addBuys.every((b) => inv.addBuyReceipts[b.id] != null);
  return allRollsArrived && allAddBuysReceived;
}

/** Roll count "X sudah diterima / Y total" per invoice — dipakai untuk indikator progres parsial
 *  di Good Receive & Material Tracking (roll yang dikirim/diterima cuma sebagian). */
export function rollArrivalProgress(inv: RawMaterialInvoice): { arrived: number; total: number } {
  let arrived = 0;
  let total = 0;
  for (const c of inv.colorEntries) {
    const key = c.warna + "|" + c.lengan;
    const arrivals = inv.rollArrivals[key] ?? [];
    total += c.rolls.length;
    arrived += c.rolls.filter((_, idx) => arrivals[idx] != null).length;
  }
  return { arrived, total };
}

/** Status ringkas kedatangan roll satu invoice (item 11), diturunkan MURNI dari
 *  `rollArrivalProgress` — tidak ada field DB baru. Dipakai di kedua sisi (Good Receive & Material
 *  Tracking) supaya keduanya selalu sinkron. */
export type RollArrivalStatus = "BELUM" | "PARSIAL" | "LENGKAP";

export function rollArrivalStatus(inv: RawMaterialInvoice): RollArrivalStatus {
  const { arrived, total } = rollArrivalProgress(inv);
  if (total === 0 || arrived === 0) return "BELUM";
  if (arrived < total) return "PARSIAL";
  return "LENGKAP";
}

export function rollArrivalStatusBadge(s: RollArrivalStatus): { label: string; tone: "neutral" | "warning" | "success" } {
  const map: Record<RollArrivalStatus, { label: string; tone: "neutral" | "warning" | "success" }> = {
    BELUM: { label: "BELUM DITERIMA", tone: "neutral" },
    PARSIAL: { label: "PARSIAL", tone: "warning" },
    LENGKAP: { label: "LENGKAP", tone: "success" },
  };
  return map[s];
}

/** Item 1.4 (feedback batch 2026-09-04): begitu transfer material dibolehkan sampai ke tahap
 *  PRODUCTION (item 1.1), roll yang code_roll-nya SUDAH dipakai suatu ProductionBatch (sudah
 *  dipilih untuk Resting -- fisiknya sudah dipotong) tidak boleh ikut pindah vendor lagi. Hitungan
 *  "roll bisa dipindahkan" per invoice ini pakai exclusion logic yang SAMA seperti
 *  `availableCodeRollsForColor` (roll dengan codeRoll yang dipakai batch mana pun MRP+vendor+
 *  warna+lengan yang sama dikeluarkan) -- dipakai untuk clamp `moveQty` di transferMaterialAction
 *  DAN untuk cap "roll belum dipotong" yang ditampilkan di TransferMaterialModal. */
export function movableRollCountForInvoice(inv: RawMaterialInvoice, batches: ProductionBatch[]): number {
  let count = 0;
  for (const c of inv.colorEntries) {
    const key = c.warna + "|" + c.lengan;
    const receipts = inv.rollReceipts[key] ?? [];
    const usedCodeRolls = new Set(
      batches
        .filter((b) => b.mrpId === inv.mrpId && b.vendorProduksi === inv.destinationVendor && b.warna === c.warna && b.lengan === c.lengan && b.codeRoll)
        .map((b) => b.codeRoll!)
    );
    for (let idx = 0; idx < c.rolls.length; idx++) {
      const cr = receipts[idx]?.codeRoll;
      if (cr && usedCodeRolls.has(cr)) continue;
      count++;
    }
  }
  return count;
}

export type PendingWeighRoll = {
  invoiceId: string;
  poId: string;
  warna: string;
  lengan: Lengan;
  rollIndex: number;
  grossKg: number;
  codeRoll?: string;
  codeLot?: string;
  arrivedAt: string;
  /** Roll ini sudah pernah ditimbang tapi selisihnya KURANG dari toleransi (item 4) & belum
   *  ditimbang ulang sesuai — perlu ditimbang ULANG (lihat materialClaimsList), bukan ditimbang
   *  pertama kali. */
  netKg?: number;
  weighConfirmedAt?: string;
};

// Item 12/13 (feedback batch 2026-09-04) — model 3 daftar di tab Cutting, semua diturunkan dari
// arrival/receipt yang sama, TIDAK ADA field DB baru selain weigh_confirmed_at (migration 0015):
//   1. pendingWeighRolls        -- arrival ada, BELUM ditimbang, ATAU sedang butuh timbang ULANG
//      (klaim aktif). Roll dengan net_kg tersimpan & tanpa klaim aktif SUDAH TIDAK muncul di sini
//      lagi (dulu tetap tampil sampai terpakai batch — sekarang pindah ke daftar 2/3 di bawah).
//   2. weighedUnconfirmedRolls  -- net_kg terisi, bebas klaim, TAPI `weighConfirmedAt` masih
//      kosong & code roll belum terpakai batch manapun -- ini yang masih bisa dikoreksi (Simpan)
//      dan yang punya tombol "Konfirmasi" (confirmRollWeighAction) sebelum bisa dipilih di
//      Resting (lihat availableCodeRollsForColor, yang mensyaratkan weighConfirmedAt != null).
//   3. (read-only, lihat production-cutting-tab.tsx "Riwayat timbang — sudah dikonfirmasi") --
//      net_kg terisi, `weighConfirmedAt` terisi, code roll belum terpakai batch -- claim masih
//      bisa diajukan dari sini (mengosongkan weighConfirmedAt lagi, balik ke daftar 1).
/** Roll yang sudah ditandai diterima (Good Receive) untuk MRP+vendor ini tapi BELUM ditimbang —
 *  atau sudah ditimbang tapi masih ada klaim selisih berat aktif (kurang dari toleransi, perlu
 *  ditimbang ulang) — dipakai di halaman Cutting sebagai daftar "Timbang roll". Roll yang sudah
 *  tersimpan net_kg-nya & bebas klaim TIDAK lagi muncul di sini (lihat weighedUnconfirmedRolls). */
/** Item 3 (feedback batch 2026-09-07): 4 dict status resolusi klaim (satu sumber kebenaran yang
 *  sama dipakai `materialClaimStage`, lihat production-cutting-tab.tsx) -- opsional & default
 *  kosong supaya caller lama (mis. badge sidebar di lib/shell/badges.ts) yang belum sempat
 *  diteruskan dict-nya tetap jalan PERSIS seperti sebelumnya (materialClaimStage dengan 4 dict
 *  kosong selalu balik "BELUM", jadi exclusion baru di bawah tidak pernah kepicu). */
export type ClaimResolutionDicts = {
  resolutions?: Record<string, unknown>;
  returRequests?: Record<string, unknown>;
  returDeliveries?: Record<string, unknown>;
  returReceipts?: Record<string, unknown>;
};

export function pendingWeighRolls(
  mrpId: string,
  vendorId: string,
  invoices: RawMaterialInvoice[],
  batches: ProductionBatch[],
  claimDicts: ClaimResolutionDicts = {}
): PendingWeighRoll[] {
  // `batches` dipertahankan di signature (dipanggil dgn argumen yang sama seperti
  // weighedUnconfirmedRolls/confirmedWeighedRolls dari UI) walau tidak dipakai lagi di sini --
  // exclusion "sudah dipakai batch" tidak lagi relevan untuk daftar 1 (lihat catatan di atas).
  void batches;
  const { resolutions = {}, returRequests = {}, returDeliveries = {}, returReceipts = {} } = claimDicts;
  const activeClaimKeys = new Set(materialClaimsList(invoices).map((c) => c.key));
  const out: PendingWeighRoll[] = [];
  for (const inv of invoices) {
    if (inv.mrpId !== mrpId || inv.destinationVendor !== vendorId) continue;
    for (const c of inv.colorEntries) {
      const key = c.warna + "|" + c.lengan;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      c.rolls.forEach((grossKg, idx) => {
        const arrival = arrivals[idx];
        if (!arrival) return;
        const receipt = receipts[idx];
        const claimKey = `${inv.id}|${key}|${idx}`;
        if (receipt != null) {
          // Roll sudah ditimbang: tetap tampil di sini SELAMA klaimnya masih aktif (perlu timbang
          // ulang) -- tapi begitu klaim itu ditutup (mis. "Buat PV Pengganti", lihat
          // createClaimReplacementInvoiceAction), stage-nya jadi SELESAI & roll LAMA ini harus
          // berhenti muncul di sini (roll penggantinya sudah masuk lewat invoice baru terpisah) --
          // sebelum fix ini, roll lama nyangkut selamanya & tampak "duplikat" dgn roll pengganti.
          const stage = materialClaimStage(claimKey, resolutions, returRequests, returDeliveries, returReceipts);
          if (!activeClaimKeys.has(claimKey) || stage === "SELESAI") return;
        }
        out.push({
          invoiceId: inv.id,
          poId: inv.poId,
          warna: c.warna,
          lengan: c.lengan,
          rollIndex: idx,
          grossKg,
          codeRoll: arrival.codeRoll,
          codeLot: arrival.codeLot,
          arrivedAt: arrival.arrivedAt,
          netKg: receipt?.netKg,
        });
      });
    }
  }
  return out;
}

/** Daftar 2 (item 12/13): roll yang sudah ditimbang, bebas klaim, TAPI belum "Konfirmasi"
 *  (`weighConfirmedAt` kosong) — masih bisa dikoreksi (Simpan per baris) dan punya tombol
 *  "Konfirmasi (n)" per grup warna·lengan (confirmRollWeighAction) sebelum bisa dipilih untuk
 *  Resting. Berhenti muncul begitu code roll-nya sudah terpakai di suatu ProductionBatch. */
export function weighedUnconfirmedRolls(mrpId: string, vendorId: string, invoices: RawMaterialInvoice[], batches: ProductionBatch[]): PendingWeighRoll[] {
  const activeClaimKeys = new Set(materialClaimsList(invoices).map((c) => c.key));
  const out: PendingWeighRoll[] = [];
  for (const inv of invoices) {
    if (inv.mrpId !== mrpId || inv.destinationVendor !== vendorId) continue;
    for (const c of inv.colorEntries) {
      const key = c.warna + "|" + c.lengan;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const usedCodeRolls = new Set(
        batches.filter((b) => b.mrpId === mrpId && b.vendorProduksi === vendorId && b.warna === c.warna && b.lengan === c.lengan && b.codeRoll).map((b) => b.codeRoll!)
      );
      c.rolls.forEach((grossKg, idx) => {
        const receipt = receipts[idx];
        if (!receipt) return;
        const claimKey = `${inv.id}|${key}|${idx}`;
        if (activeClaimKeys.has(claimKey)) return;
        if (receipt.weighConfirmedAt) return;
        if (receipt.codeRoll && usedCodeRolls.has(receipt.codeRoll)) return;
        const arrival = arrivals[idx];
        out.push({
          invoiceId: inv.id,
          poId: inv.poId,
          warna: c.warna,
          lengan: c.lengan,
          rollIndex: idx,
          grossKg,
          codeRoll: receipt.codeRoll ?? arrival?.codeRoll,
          codeLot: receipt.codeLot ?? arrival?.codeLot,
          arrivedAt: arrival?.arrivedAt ?? receipt.receivedAt,
          netKg: receipt.netKg,
          weighConfirmedAt: receipt.weighConfirmedAt,
        });
      });
    }
  }
  return out;
}

/** Daftar 3 (item 13.6): roll yang sudah "Konfirmasi" (`weighConfirmedAt` terisi) & belum
 *  terpakai di batch manapun — read-only kecuali tombol "Ajukan Claim" (membuka dialog klaim yang
 *  sama seperti item 3, dan begitu diajukan `weighConfirmedAt` di-null-kan lagi supaya roll balik
 *  ke pendingWeighRolls / masuk alur retur klaim). */
export function confirmedWeighedRolls(mrpId: string, vendorId: string, invoices: RawMaterialInvoice[], batches: ProductionBatch[]): PendingWeighRoll[] {
  const out: PendingWeighRoll[] = [];
  for (const inv of invoices) {
    if (inv.mrpId !== mrpId || inv.destinationVendor !== vendorId) continue;
    for (const c of inv.colorEntries) {
      const key = c.warna + "|" + c.lengan;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const usedCodeRolls = new Set(
        batches.filter((b) => b.mrpId === mrpId && b.vendorProduksi === vendorId && b.warna === c.warna && b.lengan === c.lengan && b.codeRoll).map((b) => b.codeRoll!)
      );
      c.rolls.forEach((grossKg, idx) => {
        const receipt = receipts[idx];
        if (!receipt || !receipt.weighConfirmedAt) return;
        if (receipt.codeRoll && usedCodeRolls.has(receipt.codeRoll)) return;
        const arrival = arrivals[idx];
        out.push({
          invoiceId: inv.id,
          poId: inv.poId,
          warna: c.warna,
          lengan: c.lengan,
          rollIndex: idx,
          grossKg,
          codeRoll: receipt.codeRoll ?? arrival?.codeRoll,
          codeLot: receipt.codeLot ?? arrival?.codeLot,
          arrivedAt: arrival?.arrivedAt ?? receipt.receivedAt,
          netKg: receipt.netKg,
          weighConfirmedAt: receipt.weighConfirmedAt,
        });
      });
    }
  }
  return out;
}

/** Total roll yang muncul di section "Timbang roll" + "Sudah ditimbang — belum dikonfirmasi"
 *  Cutting (daftar 1 & 2 dari pendingWeighRolls/weighedUnconfirmedRolls di atas), dihitung lintas
 *  SEMUA MRP untuk vendor ini — dipakai badge sidebar "Produksi" dan tab "Cutting"
 *  (lib/shell/badges.ts) supaya roll yang nyangkut di salah satu dari kedua daftar itu ikut
 *  kelihatan & badge tidak "diam" padahal masih ada kerjaan tersisa (item 12.3). Daftar 3 (sudah
 *  dikonfirmasi) sengaja TIDAK ikut dihitung — itu bukan kerjaan tertunda.
 *  `mrpId` opsional (item 3.2, post-Tester-round-1 fix): kalau diisi, hitungan di-scope ke SATU
 *  MRP saja supaya marker dropdown "pilih MRP" di tab Cutting bisa mencerminkan definisi yang
 *  sama persis dengan badge menu-level di atas (termasuk roll "sudah ditimbang tapi belum
 *  dikonfirmasi", yang sebelumnya salah dihitung pakai `pendingWeighRolls` yang TIDAK mencakup
 *  kasus itu). Kalau tidak diisi, perilaku sama seperti sebelumnya (semua MRP vendor ini). */
export function pendingWeighRollsCount(
  vendorId: string,
  invoices: RawMaterialInvoice[],
  batches: ProductionBatch[],
  mrpId?: string,
  claimDicts: ClaimResolutionDicts = {}
): number {
  const { resolutions = {}, returRequests = {}, returDeliveries = {}, returReceipts = {} } = claimDicts;
  const activeClaimKeys = new Set(materialClaimsList(invoices).map((c) => c.key));
  let count = 0;
  for (const inv of invoices) {
    if (inv.destinationVendor !== vendorId) continue;
    if (mrpId && inv.mrpId !== mrpId) continue;
    for (const c of inv.colorEntries) {
      const key = c.warna + "|" + c.lengan;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const usedCodeRolls = new Set(
        batches.filter((b) => b.mrpId === inv.mrpId && b.vendorProduksi === vendorId && b.warna === c.warna && b.lengan === c.lengan && b.codeRoll).map((b) => b.codeRoll!)
      );
      c.rolls.forEach((_grossKg, idx) => {
        const arrival = arrivals[idx];
        const receipt = receipts[idx];
        const claimKey = `${inv.id}|${key}|${idx}`;
        if (!arrival) return;
        if (!receipt) {
          count++;
          return;
        }
        if (activeClaimKeys.has(claimKey)) {
          // Sinkron dgn pendingWeighRolls di atas -- klaim yang sudah SELESAI (mis. sudah
          // dibuatkan PV pengganti) berhenti dihitung SAMA SEKALI (roll lama ini sudah "diganti"
          // & tidak lagi muncul di weighedUnconfirmedRolls/pendingWeighRolls manapun), supaya
          // badge tidak nyala terus untuk roll yang sudah tidak ada di daftar mana pun.
          if (materialClaimStage(claimKey, resolutions, returRequests, returDeliveries, returReceipts) !== "SELESAI") count++;
          return;
        }
        if (!receipt.weighConfirmedAt && !(receipt.codeRoll && usedCodeRolls.has(receipt.codeRoll))) count++;
      });
    }
  }
  return count;
}

export function startedRollsForAduan(aduanRowId: string, batches: ProductionBatch[]): number {
  return batches.filter((b) => b.aduanRowId === aduanRowId).reduce((s, b) => s + b.qtyRoll, 0);
}

/** Alokasi jumlah roll TERSEDIA (sudah ditimbang & dalam toleransi, punya code roll, belum
 *  dipakai batch) ke SEMUA baris aduan pola satu MRP sekaligus — BUKAN dihitung independen per
 *  baris seperti dulu (`availableRollsForAduanRow`). Baris aduan dengan warna+lengan yang sama
 *  (mis. beberapa "kode" pola berbeda tapi warnanya sama) berbagi SATU pool roll fisik yang sama
 *  — roll belum "milik" kode tertentu sampai benar-benar dipilih & di-Resting. Kalau tiap baris
 *  dihitung independen (masing-masing dibatasi ke ANGKA POOL PENUH), jumlah gabungan lintas baris
 *  bisa lebih besar dari roll yang benar-benar ada di pool — terutama begitu pool berkurang (mis.
 *  1 roll terkunci klaim selisih berat, lihat pendingWeighRolls/materialClaimsList): tanpa fix
 *  ini, 3 baris dengan qtyRoll 1/2/1 dari pool 3 roll bisa sama-sama tampil "tersedia" penuh dan
 *  jumlahnya 4, bukan 3. Sekarang pool dialokasikan BERURUTAN sesuai urutan baris (array order),
 *  jadi total gabungan selalu pas dengan roll yang benar-benar ada. */
export function availableRollsByAduanRow(aduanRows: AduanPolaRow[], invoices: RawMaterialInvoice[], batches: ProductionBatch[], mrpId: string): Record<string, number> {
  const poolByColor = new Map<string, number>();
  const out: Record<string, number> = {};
  for (const row of aduanRows) {
    const colorKey = row.vendor + "|" + row.warna + "|" + row.lengan;
    if (!poolByColor.has(colorKey)) {
      const received = receivedRollCountWithCodeForColor(mrpId, row.vendor, row.warna, row.lengan, invoices);
      const sameColorRows = aduanRows.filter((a) => a.vendor === row.vendor && a.warna === row.warna && a.lengan === row.lengan);
      const startedForColor = sameColorRows.reduce((s, r) => s + startedRollsForAduan(r.id, batches), 0);
      poolByColor.set(colorKey, Math.max(0, received - startedForColor));
    }
    const remainingForRow = Math.max(0, row.qtyRoll - startedRollsForAduan(row.id, batches));
    const poolLeft = poolByColor.get(colorKey)!;
    const claimed = Math.min(remainingForRow, poolLeft);
    out[row.id] = claimed;
    poolByColor.set(colorKey, poolLeft - claimed);
  }
  return out;
}

export function restingMinutes(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(0, Math.round((to - from) / 60000));
}

export function formatDuration(fromIso: string, toIso: string): string {
  const mins = restingMinutes(fromIso, toIso);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}j ${m}m`;
}

export function availableCodeRollsForColor(
  mrpId: string,
  warna: string,
  lengan: Lengan,
  vendorId: string,
  invoices: RawMaterialInvoice[],
  batches: ProductionBatch[]
): string[] {
  const key = warna + "|" + lengan;
  const received: string[] = [];
  for (const inv of invoices) {
    if (inv.mrpId !== mrpId || inv.destinationVendor !== vendorId) continue;
    const colorEntry = inv.colorEntries.find((c) => c.warna === warna && c.lengan === lengan);
    (inv.rollReceipts[key] ?? []).forEach((r, idx) => {
      if (!r || !r.codeRoll) return;
      // Sama seperti receivedRollCountWithCodeForColor — roll dengan klaim aktif (lebih RINGAN
      // dari toleransi, item 4) tidak boleh muncul sebagai code roll yang bisa dipilih untuk
      // Resting/Cutting, dan roll juga harus sudah "Konfirmasi" (item 13).
      const grossKg = colorEntry?.rolls[idx];
      if (grossKg !== undefined && weightVariance(grossKg, r.netKg).claimable) return;
      if (!r.weighConfirmedAt) return;
      received.push(r.codeRoll!);
    });
  }
  const used = new Set(
    batches.filter((b) => b.mrpId === mrpId && b.vendorProduksi === vendorId && b.warna === warna && b.lengan === lengan && b.codeRoll).map((b) => b.codeRoll!)
  );
  return received.filter((c) => !used.has(c));
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Format tanggal `yy-mm-dd` + jam 12-jam `hh:mm AM/PM`, mis. "26-09-02 03:45 PM" — dipakai di
 *  riwayat pencatatan Finish Good/Reject supaya konsisten sortable-by-text dan jamnya tidak
 *  ambigu (beda dari formatDateTime yang 24 jam ala id-ID). */
export function formatDateTimeShort(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${yy}-${mm}-${dd} ${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}

export function cutWarnaLenganGroups(mrpId: string, vendorProduksi: string, batches: ProductionBatch[]): { warna: string; lengan: Lengan }[] {
  const seen = new Map<string, { warna: string; lengan: Lengan }>();
  for (const b of batches) {
    if (b.mrpId !== mrpId || b.vendorProduksi !== vendorProduksi || !b.cuttingAt) continue;
    const key = b.warna + "|" + b.lengan;
    if (!seen.has(key)) seen.set(key, { warna: b.warna, lengan: b.lengan });
  }
  return Array.from(seen.values());
}

export type RestingSessionGroup = {
  key: string; // `${mrpId}|${kode}|${lengan}|${restingEpochMs}` (atau string resting_at mentah kalau NaN, lihat catatan di bawah)
  mrpId: string;
  kode: string;
  lengan: Lengan;
  restingAt: string; // ISO -- identik untuk semua batch di sesi ini
  partNo: number; // 1-based, kronologis per (mrpId|kode|lengan)
  partTotal: number;
  batches: ProductionBatch[];
};

/** Item 5 (feedback batch 2026-09-05): kelompokkan ProductionBatch jadi "sesi resting" ("Part")
 *  untuk tabel "Material dalam produksi" (production-cutting-tab.tsx) -- 1 baris per
 *  (mrpId, kode, lengan, waktu resting), bukan lagi 1 baris per ROLL.
 *
 *  Bucket by EXACT timestamp equality (`Date.parse`), TANPA tolerance window -- ini aman karena
 *  `submitResting` (production-cutting-tab.tsx) menghitung `effectiveRestingAt` SATU KALI sebelum
 *  loop per-roll, dan `startProductionBatchAction` (lib/mrp/actions.ts:1630) menyimpan string itu
 *  APA ADANYA ke kolom `resting_at` -- jadi semua roll dari SATU submission dijamin byte-identical.
 *  Tolerance window (mis. +-1 menit) justru SALAH di sini: 2 stack roll yang disubmit terpisah
 *  semenit kemudian akan salah tergabung jadi satu Part, padahal itu 2 stack fisik berbeda.
 *
 *  Kalau `Date.parse` menghasilkan NaN, fallback ke string resting_at mentah sebagai bucket id
 *  (defensif -- jangan pernah crash gara-gara data lama yang aneh).
 *
 *  Edge case terdokumentasi (bukan bug):
 *  - Batch yang ditulis SEBELUM migration 0010 (resting_at masih date-only, jam 00:00) akan
 *    collapse jadi SATU Part per HARI untuk kode+lengan yang sama -- cuma memengaruhi data
 *    historis, diterima sebagai trade-off.
 *  - 2 submission yang di-backdate MANUAL ke datetime yang PERSIS sama akan tergabung jadi satu
 *    Part -- ini disengaja/diinginkan (bukan bug). */
export function restingSessionGroups(batches: ProductionBatch[]): RestingSessionGroup[] {
  type Bucket = { mrpId: string; kode: string; lengan: Lengan; restingAt: string; sortKey: number | string; batches: ProductionBatch[] };
  const buckets = new Map<string, Bucket>();
  for (const b of batches) {
    const parsed = Date.parse(b.restingAt);
    const sortKey: number | string = Number.isNaN(parsed) ? b.restingAt : parsed;
    const bucketKey = `${b.mrpId}|${b.kode}|${b.lengan}|${sortKey}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.batches.push(b);
    else buckets.set(bucketKey, { mrpId: b.mrpId, kode: b.kode, lengan: b.lengan, restingAt: b.restingAt, sortKey, batches: [b] });
  }

  const byTriple = new Map<string, Bucket[]>();
  for (const bucket of buckets.values()) {
    const tripleKey = `${bucket.mrpId}|${bucket.kode}|${bucket.lengan}`;
    const arr = byTriple.get(tripleKey) ?? [];
    arr.push(bucket);
    byTriple.set(tripleKey, arr);
  }

  const out: RestingSessionGroup[] = [];
  for (const arr of byTriple.values()) {
    arr.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    const partTotal = arr.length;
    arr.forEach((bucket, idx) => {
      const sortedBatches = [...bucket.batches].sort((a, b) => a.warna.localeCompare(b.warna) || (a.codeRoll ?? "").localeCompare(b.codeRoll ?? ""));
      out.push({
        key: `${bucket.mrpId}|${bucket.kode}|${bucket.lengan}|${bucket.sortKey}`,
        mrpId: bucket.mrpId,
        kode: bucket.kode,
        lengan: bucket.lengan,
        restingAt: bucket.restingAt,
        partNo: idx + 1,
        partTotal,
        batches: sortedBatches,
      });
    });
  }

  out.sort((a, b) => a.mrpId.localeCompare(b.mrpId) || a.kode.localeCompare(b.kode) || a.lengan.localeCompare(b.lengan) || a.partNo - b.partNo);
  return out;
}

/** Sama seperti cutWarnaLenganGroups, TAPI juga menyertakan grup warna/lengan yang TIDAK PERNAH
 *  dicutting tapi punya Finish Good tercatat -- ini bisa terjadi karena rework lintas lengan
 *  (reject PANJANG dirework jadi baju di lengan PENDEK, lihat reworkRejectSizeAction) menghasilkan
 *  FG dengan groupKey TUJUAN yang boleh jadi belum pernah punya batch cutting sendiri. Tanpa ini,
 *  grup tujuan itu jadi "hantu" -- tidak pernah muncul di tab Finish Good/Final Produksi, sehingga
 *  TIDAK PERNAH bisa di-"Selesai Produksi"-kan / masuk Pengiriman selamanya (availableFgToShip
 *  mensyaratkan productionGroupMeta.doneAt per groupKey, yang tidak akan pernah bisa diisi kalau
 *  grupnya sendiri tidak pernah tampil di UI). Dipakai di tab Finish Good/Final Produksi & badges
 *  supaya grup tujuan rework begini tetap kelihatan dan bisa diselesaikan seperti grup biasa. */
export function warnaLenganGroupsWithFg(mrpId: string, vendorProduksi: string, batches: ProductionBatch[], results: ProductionResult[]): { warna: string; lengan: Lengan }[] {
  const seen = new Map<string, { warna: string; lengan: Lengan }>();
  for (const g of cutWarnaLenganGroups(mrpId, vendorProduksi, batches)) seen.set(g.warna + "|" + g.lengan, g);
  for (const r of results) {
    if (r.mrpId !== mrpId || r.vendorProduksi !== vendorProduksi || r.kind !== "FG") continue;
    const key = r.warna + "|" + r.lengan;
    if (!seen.has(key)) seen.set(key, { warna: r.warna, lengan: r.lengan });
  }
  return Array.from(seen.values());
}

export function targetSizesForGroup(mrpId: string, warna: string, lengan: Lengan, mrpDetails: MrpDetail[], batches: ProductionBatch[]): Record<string, number> {
  const detail = mrpDetailFor(mrpId, mrpDetails);
  if (!detail) return {};
  const out: Record<string, number> = {};
  for (const b of batches) {
    if (b.mrpId !== mrpId || b.warna !== warna || b.lengan !== lengan || !b.cuttingAt) continue;
    const aduanRow = detail.aduanRows.find((a) => a.id === b.aduanRowId);
    if (!aduanRow || aduanRow.qtyRoll <= 0) continue;
    const ratio = b.qtyRoll / aduanRow.qtyRoll;
    for (const s of aduanRow.sizes) out[s.size] = (out[s.size] ?? 0) + Math.round(s.qty * ratio);
  }
  return out;
}

/** Target qty per SIZE untuk 1 roll/batch tertentu — aduanRow.sizes diprorate dengan rasio
 *  qtyRoll batch ini terhadap total qtyRoll rencana aduan itu (sama logikanya dengan
 *  targetSizesForGroup, tapi untuk 1 batch saja, bukan digabung se-grup). Dipakai untuk
 *  menampilkan target di form "Timbang roll"/"Update ke Cutting" Cutting tab, dan sebagai
 *  penyebut yield per roll (lihat productionYieldAlertsList). */
export function targetSizesForBatch(batch: ProductionBatch, aduanRows: AduanPolaRow[]): Record<string, number> {
  const aduanRow = aduanRows.find((a) => a.id === batch.aduanRowId);
  if (!aduanRow || aduanRow.qtyRoll <= 0) return {};
  const ratio = batch.qtyRoll / aduanRow.qtyRoll;
  const out: Record<string, number> = {};
  for (const s of aduanRow.sizes) out[s.size] = Math.round(s.qty * ratio);
  return out;
}

/** Hasil aduan AKTUAL (bukan estimasi) per size untuk 1 grup warna/lengan — dijumlah dari
 *  ProductionBatch.sizeQty semua roll yang sudah dicutting DAN sudah diisi hasil aduannya.
 *  Kosong kalau belum ada batch yang diisi (batch lama sebelum fitur ini, atau migration 0006
 *  belum jalan) — lihat cuttingSizesForGroup untuk fallback ke estimasi lama. */
export function actualCutSizesForGroup(mrpId: string, warna: string, lengan: Lengan, batches: ProductionBatch[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of batches) {
    if (b.mrpId !== mrpId || b.warna !== warna || b.lengan !== lengan || !b.cuttingAt || !b.sizeQty) continue;
    for (const [size, qty] of Object.entries(b.sizeQty)) out[size] = (out[size] ?? 0) + qty;
  }
  return out;
}

/** "Total Qty" hasil cutting per grup warna/lengan — item 18.1 (feedback batch 2026-09-04):
 *  SELALU hasil aduan AKTUAL yang diinput vendor per roll (actualCutSizesForGroup). Dulu ada
 *  fallback ke estimasi rasio rencana MRP (targetSizesForGroup) kalau belum ada satu pun batch
 *  yang diisi hasil aduannya — itu ROOT CAUSE bug reject dobel-hitung (mis. target 10, cutting
 *  aktual 8, FG 6, reject seharusnya 2 tapi tampil 4): begitu hasil cutting belum diisi,
 *  confirmFgDoneAction diam-diam memakai target 10 sebagai baseline, jadi gap rencana-vs-cutting
 *  (2) ikut terhitung sebagai reject. Sekarang fallback itu DIHAPUS — grup yang punya batch cutting
 *  tapi belum ada satupun yang diisi hasil aduannya akan mengembalikan `{}` (kosong), dan
 *  confirmFgDoneAction (lihat actions.ts) menolak "Selesai Produksi" untuk kasus itu sampai
 *  "Input Hasil Cutting" diisi — bukan lagi diam-diam memakai angka rencana PO/MRP.
 *  `targetSizesForGroup` (rencana PO/MRP) tetap ada sebagai figur TERPISAH untuk perbandingan
 *  "Qty PO" (lihat productionYieldByWarna/BySize) — tidak lagi dipakai sebagai basis reject. */
export function cuttingSizesForGroup(mrpId: string, warna: string, lengan: Lengan, _mrpDetails: MrpDetail[], batches: ProductionBatch[]): Record<string, number> {
  return actualCutSizesForGroup(mrpId, warna, lengan, batches);
}

export const YIELD_ALERT_THRESHOLD_PCT = 99;

export type ProductionYieldAlertRow = {
  batchId: string;
  mrpId: string;
  vendorProduksi: string;
  warna: string;
  lengan: Lengan;
  codeRoll?: string;
  gramasi: number;
  cuttingAt: string;
  targetQty: number;
  actualQty: number;
  yieldPct: number;
  resolved: boolean;
};

/** Roll yang sudah dicutting & diisi hasil aduannya tapi yield-nya (aktual/target) di bawah
 *  YIELD_ALERT_THRESHOLD_PCT — mirip pola materialClaimsList (weight tolerance) tapi untuk yield
 *  qty, dan dilempar ke portal internal Produksi (bukan Procurement) via
 *  resolveProductionYieldAction/productionYieldResolutions. */
export function productionYieldAlertsList(
  batches: ProductionBatch[],
  mrpDetails: MrpDetail[],
  resolutions: Record<string, ProductionYieldResolution> = {}
): ProductionYieldAlertRow[] {
  const out: ProductionYieldAlertRow[] = [];
  for (const b of batches) {
    if (!b.cuttingAt || !b.sizeQty) continue;
    const detail = mrpDetailFor(b.mrpId, mrpDetails);
    const target = targetSizesForBatch(b, detail?.aduanRows ?? []);
    const targetQty = Object.values(target).reduce((a, c) => a + c, 0);
    if (targetQty <= 0) continue;
    const actualQty = Object.values(b.sizeQty).reduce((a, c) => a + c, 0);
    const yieldPct = (actualQty / targetQty) * 100;
    if (yieldPct >= YIELD_ALERT_THRESHOLD_PCT) continue;
    out.push({
      batchId: b.id,
      mrpId: b.mrpId,
      vendorProduksi: b.vendorProduksi,
      warna: b.warna,
      lengan: b.lengan,
      codeRoll: b.codeRoll,
      gramasi: b.gramasi,
      cuttingAt: b.cuttingAt,
      targetQty,
      actualQty,
      yieldPct,
      resolved: !!resolutions[b.id],
    });
  }
  return out.sort((a, b) => (a.cuttingAt < b.cuttingAt ? 1 : -1));
}

export function cumulativeSizeQtyForGroup(groupKey: string, kind: ProductionResultKind, results: ProductionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.kind !== kind || r.groupKey !== groupKey) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) out[size] = (out[size] ?? 0) + qty;
  }
  return out;
}

/** True kalau SEMUA grup warna/lengan yang sudah di-cutting untuk PO maklon ini sudah
 *  mencapai target qty Finish Good-nya — dipakai untuk auto-advance status PO maklon dari
 *  PRODUCTION ke DELIVERY begitu semua target tercapai (bukan tombol manual lagi). Kalau
 *  belum ada satupun grup yang di-cutting, atau targetnya belum diketahui (mis. aduan pola
 *  belum lengkap), dianggap belum selesai.
 *
 *  BUG FIX (2026-09-09, user-reported: "kenapa hilang list MRP-nya ... padahal masih ada
 *  beberapa yang belum saya masukkan ke finish good ... karena ada beberapa roll yang saya
 *  masukkan sampai ke tahap akhir (payment dan invoice)"): `cutWarnaLenganGroups` di bawah cuma
 *  mengembalikan grup warna/lengan yang SUDAH py `cuttingAt` -- roll yang MASIH resting (belum
 *  sempat cutting sama sekali) tidak pernah ikut diperiksa `groups.every(...)`. Akibatnya: begitu
 *  SEMUA grup yang SUDAH selesai cutting+FG mencapai target (mis. karena sudah dikirim & full
 *  diinvoice), fungsi ini menganggap PO ini "selesai total" & auto-advance status ke DELIVERY --
 *  padahal ada roll BARU (baru masuk resting SETELAH grup2 lain kelar) yang belum sempat
 *  diproses sama sekali. Begitu status PO pindah dari PRODUCTION, MRP ini hilang dari dropdown
 *  "pilih MRP" di SEMUA tab Produksi (readyMrpIds di masing2 tab cuma terima status PRODUCTION/
 *  *_WAITING_MATERIAL) -- vendor jadi tidak bisa lagi input apa pun untuk roll baru itu, meski
 *  datanya sendiri masih kelihatan di tabel "Material dalam produksi" (query terpisah, tidak
 *  digembok status PO). Fix: roll yang masih resting (belum cuttingAt) untuk mrpId+vendor ini
 *  membuat fungsi langsung return false (belum selesai), sebelum sempat cuma melihat grup yang
 *  sudah cutting saja. */
export function maklonProductionFullyDone(
  mrpId: string,
  vendorProduksi: string,
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  results: ProductionResult[]
): boolean {
  const hasUncutBatch = batches.some((b) => b.mrpId === mrpId && b.vendorProduksi === vendorProduksi && !b.cuttingAt);
  if (hasUncutBatch) return false;

  const groups = cutWarnaLenganGroups(mrpId, vendorProduksi, batches);
  if (groups.length === 0) return false;
  return groups.every((g) => {
    const target = targetSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, batches);
    const targetTotal = Object.values(target).reduce((a, b) => a + b, 0);
    if (targetTotal <= 0) return false;
    const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
    const fgTotal = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", results)).reduce((a, b) => a + b, 0);
    return fgTotal >= targetTotal;
  });
}

// BUG FIX (2026-09-09, live-verified: grup ABU MUDA 24S · PENDEK PO-01 sudah "Final" -- doneAt
// terisi, reworkRejectSizeAction MENOLAK rework begitu done_at terisi -- tapi badge Reject/Rework
// & sidebar Produksi tetap nyala terus karena fungsi ini tidak pernah cek `done`). Begitu grup
// dikunci Final Produksi, sisa reject-nya memang sudah tidak bisa ditindak apa pun lagi (bukan
// "belum sempat", tapi "sudah tidak mungkin") -- jadi TIDAK lagi dihitung "perlu aksi" di sini.
// `productionGroupMeta` jadi parameter baru (dulu tidak butuh, fungsi ini cuma dari batches+results)
// supaya bisa cek `doneAt` per groupKey, sama seperti `productionGroupGaps` di lib/shell/badges.ts.
export function mrpIdsWithRemainingReject(
  vendorProduksi: string,
  batches: ProductionBatch[],
  results: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[]
): string[] {
  const mrpIds = Array.from(new Set(batches.filter((b) => b.vendorProduksi === vendorProduksi && b.cuttingAt).map((b) => b.mrpId)));
  return mrpIds.filter((mrpId) => {
    const groups = cutWarnaLenganGroups(mrpId, vendorProduksi, batches);
    return groups.some((g) => {
      const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
      if (productionGroupMetaFor(groupKey, productionGroupMeta)?.doneAt) return false;
      return Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", results)).some((v) => v > 0);
    });
  });
}

// Format sebagai YYYY-MM-DD berdasarkan komponen tanggal LOKAL (bukan toISOString/UTC), supaya
// tidak mundur satu hari di timezone UTC+ (mis. WIB) ketika tengah malam lokal jatuh di hari
// sebelumnya menurut UTC.
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

export function productionGroupMetaFor(groupKey: string, metas: ProductionGroupMeta[]): ProductionGroupMeta | undefined {
  return metas.find((m) => m.groupKey === groupKey);
}

export type ProductionStatusInfo = { label: string; days: number } | null;

export function invoiceYieldSummary(inv: VendorInvoice, mrpDetails: MrpDetail[], batches: ProductionBatch[], results: ProductionResult[]): { target: number; finishGood: number; yieldPct: number } {
  let target = 0;
  let finishGood = 0;
  for (const line of inv.lines) {
    const t = targetSizesForGroup(line.mrpId, line.warna, line.lengan, mrpDetails, batches);
    const groupKey = line.mrpId + "|" + line.warna + "|" + line.lengan;
    const fg = cumulativeSizeQtyForGroup(groupKey, "FG", results);
    target += Object.values(t).reduce((a, b) => a + b, 0);
    finishGood += Object.values(fg).reduce((a, b) => a + b, 0);
  }
  return { target, finishGood, yieldPct: target > 0 ? (finishGood / target) * 100 : 0 };
}

export function targetDoneProduksiForGroup(mrpId: string, vendorProduksi: string, warna: string, invoices: RawMaterialInvoice[]): string | undefined {
  const leadDays = VENDOR_PRODUKSI[vendorProduksi]?.productionLeadDays ?? 7;
  const receivedDates = invoices
    .filter((i) => i.destinationVendor === vendorProduksi && i.mrpId === mrpId && i.receivedAt && i.colorEntries.some((c) => c.warna === warna))
    .map((i) => i.receivedAt as string);
  if (receivedDates.length === 0) return undefined;
  const latest = receivedDates.reduce((a, b) => (a > b ? a : b));
  return addDays(latest, leadDays);
}

export function productionStatusFromDates(targetDoneAt: string | undefined, doneAt: string | undefined): ProductionStatusInfo {
  if (!targetDoneAt || !doneAt) return null;
  const target = new Date(targetDoneAt + "T00:00:00").getTime();
  const done = new Date(doneAt + "T00:00:00").getTime();
  const diffDays = Math.round((done - target) / 86400000);
  if (diffDays > 0) return { label: "DELAY", days: diffDays };
  if (diffDays < 0) return { label: "LEBIH CEPAT", days: -diffDays };
  return { label: "ONTIME", days: 0 };
}

export function invoiceProductionStatus(inv: VendorInvoice, metas: ProductionGroupMeta[], invoices: RawMaterialInvoice[]): ProductionStatusInfo {
  for (const line of inv.lines) {
    const groupKey = line.mrpId + "|" + line.warna + "|" + line.lengan;
    const meta = productionGroupMetaFor(groupKey, metas);
    const target = targetDoneProduksiForGroup(line.mrpId, inv.vendorProduksi, line.warna, invoices);
    const status = productionStatusFromDates(target, meta?.doneAt);
    if (status) return status;
  }
  return null;
}

export function sizeTotalForKind(vendorProduksi: string, kind: ProductionResultKind, results: ProductionResult[]): number {
  return results
    .filter((r) => r.vendorProduksi === vendorProduksi && r.kind === kind)
    .reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0);
}

export type ReceivedNotProducedRow = { mrpId: string; warna: string; lengan: Lengan; received: number; used: number; remaining: number };

export function receivedNotYetProducedRows(vendorId: string, invoices: RawMaterialInvoice[], batches: ProductionBatch[]): ReceivedNotProducedRow[] {
  const receivedMap = new Map<string, { mrpId: string; warna: string; lengan: Lengan; count: number }>();
  for (const inv of invoices) {
    if (inv.destinationVendor !== vendorId) continue;
    for (const [key, receipts] of Object.entries(inv.rollReceipts)) {
      const count = receipts.filter((r) => r != null).length;
      if (count === 0) continue;
      const [warna, lengan] = key.split("|");
      const mapKey = inv.mrpId + "|" + key;
      const cur = receivedMap.get(mapKey) ?? { mrpId: inv.mrpId, warna, lengan: lengan as Lengan, count: 0 };
      cur.count += count;
      receivedMap.set(mapKey, cur);
    }
  }
  const usedMap = new Map<string, number>();
  for (const b of batches) {
    if (b.vendorProduksi !== vendorId) continue;
    const key = b.mrpId + "|" + b.warna + "|" + b.lengan;
    usedMap.set(key, (usedMap.get(key) ?? 0) + b.qtyRoll);
  }
  const out: ReceivedNotProducedRow[] = [];
  for (const [key, v] of receivedMap.entries()) {
    const used = usedMap.get(key) ?? 0;
    out.push({ mrpId: v.mrpId, warna: v.warna, lengan: v.lengan, received: v.count, used, remaining: v.count - used });
  }
  return out;
}

/** 1 PO maklon (mrpId+vendorProduksi) cuma boleh ditagihkan lewat SATU jalur invoice —
 *  "maklon" (per-PO, base fee, lunas sekaligus) ATAU "vendor" (per-pcs, bisa dicicil) — bukan
 *  dua-duanya, supaya vendor tidak dibayar dobel untuk pekerjaan yang sama. Siapa yang submit
 *  duluan mengunci PO itu ke jalur tsb. Catatan: `MaklonInvoice` tidak punya status
 *  dibatalkan/ditolak (cuma maju SUBMITTED→APPROVED→PAID), jadi begitu terkunci, kuncinya
 *  permanen selama belum ada mekanisme pembatalan invoice di sistem ini — `VendorInvoice`
 *  berstatus REVISION tetap dianggap mengunci (belum dibatalkan, cuma diminta perbaikan). */
export function maklonPoInvoiceLockedBy(
  mrpId: string,
  vendorProduksi: string,
  maklonInvoices: MaklonInvoice[],
  vendorInvoices: VendorInvoice[]
): "maklon" | "vendor" | null {
  if (maklonInvoices.some((i) => i.mrpId === mrpId && i.vendorProduksi === vendorProduksi)) return "maklon";
  if (vendorInvoices.some((i) => i.vendorProduksi === vendorProduksi && i.lines.some((l) => l.mrpId === mrpId))) return "vendor";
  return null;
}

export type MaklonPoProgress = { targetQty: number; deliveredQty: number; invoicedQty: number; deliveredPct: number; invoicedPct: number };

/** Progress pengiriman & penagihan 1 PO maklon terhadap target qty-nya (`po.qty`) — dipakai
 *  untuk indikator "X dari Y pcs sudah dikirim/ditagih" di halaman Purchase Order, supaya
 *  Procurement/Finance tidak perlu hitung manual. Ini MURNI indikator visibilitas, BUKAN
 *  gerbang/validasi — sistem sengaja tidak mewajibkan PO 100% selesai dulu baru boleh
 *  dikirim/ditagih (produksi garmen wajar selesai bergelombang per size/warna, lihat diskusi
 *  terkait konsolidasi jalur invoice).
 *  - `deliveredQty` cuma menghitung item berkind "FG" (barang jadi) dari koli yang sudah
 *    `deliveredAt` — reject/rework yang belum diproses ulang jadi FG tidak dihitung sebagai
 *    "terkirim memenuhi PO", karena rework yang sudah jadi FG lagi otomatis tercatat balik
 *    sebagai entri kind "FG" (lihat `reworkRejectSize` di store.ts).
 *  - `invoicedQty` menjumlahkan baris `VendorInvoice` (jalur per-pcs) untuk PO ini, invoice
 *    berstatus REVISION tidak dihitung (belum final). Kalau PO ini ternyata ditagih lewat
 *    jalur Invoice Maklon lama (lump sum, lihat `maklonPoInvoiceLockedBy`), angka ini akan
 *    selalu 0 walau PO-nya sudah lunas — pemanggil perlu cek lock itu secara terpisah untuk
 *    menampilkan pesan yang sesuai, bukan langsung menganggap 0% berarti belum dibayar. */
export function maklonPoDeliveryProgress(po: MaklonPO, deliveryKolis: DeliveryKoli[], vendorInvoices: VendorInvoice[]): MaklonPoProgress {
  const targetQty = po.qty;
  const deliveredQty = deliveryKolis
    .filter((k) => k.mrpId === po.mrpId && k.vendorProduksi === po.vendorProduksi && k.deliveredAt)
    .flatMap((k) => k.items)
    .filter((it) => (it.kind ?? "FG") === "FG")
    .reduce((s, it) => s + it.qty, 0);
  const invoicedQty = vendorInvoices
    .filter((i) => i.vendorProduksi === po.vendorProduksi && i.status !== "REVISION")
    .flatMap((i) => i.lines)
    .filter((l) => l.mrpId === po.mrpId)
    .reduce((s, l) => s + l.qty, 0);
  return {
    targetQty,
    deliveredQty,
    invoicedQty,
    deliveredPct: targetQty > 0 ? Math.min(100, Math.round((deliveredQty / targetQty) * 100)) : 0,
    invoicedPct: targetQty > 0 ? Math.min(100, Math.round((invoicedQty / targetQty) * 100)) : 0,
  };
}

// Item revisi 2026-09-08 (owner, tab Rework: "Yang bisa dirework adalah size yang sama ukurannya
// dengan juga yang ada dibawah size yang ingin dirework tersebut" -- BUG NYATA, dropdown "Size
// baru" dulu menampilkan SEMUA size MRP tanpa filter sama sekali, termasuk size LEBIH BESAR dari
// size asal -- mustahil secara fisik (motong kain reject cuma bisa mengecilkan potongan, tidak
// bisa "menambah kain"). Satu-satunya urutan size canonical di app ini -- dipakai client
// (production-rework-tab.tsx, filter dropdown) DAN server (reworkRejectSizeAction, validasi
// ulang) supaya satu sumber kebenaran. Size di luar daftar ini (custom/tidak dikenal) SENGAJA
// tidak diblokir (fail-open, lihat reworkSizeAllowed) -- daripada diam-diam menghilangkan opsi
// yang mungkin valid dari data yang tidak terduga.
export const SIZE_ORDER = ["S", "M", "L", "XL", "2XL", "3XL"];

export function sizeIndex(size: string): number {
  return SIZE_ORDER.indexOf(size.trim().toUpperCase());
}

/** True kalau `toSize` boleh jadi tujuan rework dari `fromSize` -- size dikenal: cuma boleh sama
 *  atau lebih kecil (index lebih rendah/sama) di SIZE_ORDER. Size TIDAK dikenal (custom, bukan
 *  bagian SIZE_ORDER) di salah satu sisi: fail-open (selalu diizinkan) -- lihat catatan di atas. */
export function reworkSizeAllowed(fromSize: string, toSize: string): boolean {
  const fromIdx = sizeIndex(fromSize);
  const toIdx = sizeIndex(toSize);
  if (fromIdx === -1 || toIdx === -1) return true;
  return toIdx <= fromIdx;
}

export type AvailableFgRow = { warna: string; lengan: Lengan; size: string; usia?: Usia; available: number };

function isReworkResult(r: ProductionResult): boolean {
  return !!r.note && r.note.startsWith("Rework dari");
}

// Item revisi 2026-09-07 (owner: "Apa yang terjadi jika saya klik kirim per roll dan per size?
// apakah akan double?" -- BUG NYATA, dikonfirmasi lewat trace kode): closeProductionBatchAction
// ("Tutup Roll") DUAL-WRITE 1 ProductionResult (note "Roll {codeRoll}") ke pool production_results
// yang SAMA dipakai fgProducedBySize/availableFgToShip -- tanpa exclusion ini, roll yang sudah
// "Tutup Roll" & BELUM masuk koli manapun akan muncul DUA KALI sebagai "bisa dikirim": sekali di
// "Pilih Roll Finish Good" (closedUnshippedRollsForMrp, basis ProductionBatch.closedAt) DAN sekali
// lagi di tabel "Isi Koli" (availableFgToShip, basis pool production_results) -- kalau vendor
// pilih roll itu VIA CHECKBOX *dan* ISI QTY-nya manual di "Isi Koli" dalam satu "Simpan koli" yang
// sama, roll_items (dari checkbox) DAN validItems (dari Isi Koli) SAMA-SAMA masuk koli.items ->
// pcs roll itu tercatat 2x di koli yang sama. Fix: exclude entry dual-write "Roll ..." dari basis
// FG "Isi Koli" -- roll yang sudah ditutup HANYA shippable lewat checkbox "dikirim utuh"
// (closedUnshippedRollsForMrp), TIDAK lagi ikut campur ke pool "Isi Koli" (yang sesuai namanya --
// "REWORK & SISA FG LAMA" -- sekarang MEMANG murni untuk itu: rework + FG lama dari sebelum fitur
// HPP per roll ada, bukan roll baru).
function isRollClosureResult(r: ProductionResult): boolean {
  return !!r.note && r.note.startsWith("Roll ");
}

// Item 20: Reject bukan lagi produk yang bisa dikirim -- resultMatchesShippableKind sekarang cuma
// membedakan FG "murni" (hasil cutting langsung) vs REWORK (reject yang dipotong ulang jadi FG).
function resultMatchesShippableKind(r: ProductionResult, source: ShippableKind): boolean {
  if (source === "REWORK") return r.kind === "FG" && isReworkResult(r);
  return r.kind === "FG" && !isReworkResult(r) && !isRollClosureResult(r);
}

export function fgProducedBySize(mrpId: string, vendorProduksi: string, results: ProductionResult[], source: ShippableKind = "FG"): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    if (r.mrpId !== mrpId || r.vendorProduksi !== vendorProduksi || !resultMatchesShippableKind(r, source)) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      const key = r.warna + "|" + r.lengan + "|" + size + "|" + (r.usia ?? "");
      map.set(key, (map.get(key) ?? 0) + qty);
    }
  }
  return map;
}

export function fgPackedBySize(mrpId: string, vendorProduksi: string, kolis: DeliveryKoli[], excludeKoliId?: string, source: ShippableKind = "FG"): Map<string, number> {
  const map = new Map<string, number>();
  for (const k of kolis) {
    if (k.mrpId !== mrpId || k.vendorProduksi !== vendorProduksi || k.id === excludeKoliId) continue;
    for (const item of k.items) {
      if ((item.kind ?? "FG") !== source) continue;
      const key = item.warna + "|" + item.lengan + "|" + item.size + "|" + (item.usia ?? "");
      map.set(key, (map.get(key) ?? 0) + item.qty);
    }
  }
  return map;
}

// Item 22 (feedback batch 2026-09-04, merevisi gate yang dibangun di sesi ini juga): FG sudah
// "terkunci" dan reject-nya sudah dihitung final begitu tahap 1 ("Selesai Produksi" di tab FINISH
// GOOD, `fgConfirmedAt`) diklik -- jadi AMAN dikirim dari titik itu, tidak perlu menunggu tahap 2
// (`doneAt`, "Selesai Produksi" di tab FINAL PRODUKSI) lagi seperti desain sebelumnya. Konsekuensi
// yang DIINGINKAN: FG yang ditambahkan ke grup yang SUDAH fgConfirmed sebelumnya (mis. hasil
// rework dari lengan lain) otomatis ikut shippable begitu tersimpan, tanpa perlu re-confirm --
// akan masuk ke koli BERIKUTNYA secara alami. `doneAt` tetap ada sebagai KUNCI FINAL (freeze
// FG/reject/rework, basis on-time/delay) tapi BUKAN LAGI gate Pengiriman.
// Yang MASIH bisa memblokir pengiriman: Close PO (item 21, `MaklonPO.closedAt`) -- begitu PO
// Produksi (mrpId+vendorProduksi) ditutup, SEMUA Finish Good yang belum masuk koli langsung tidak
// shippable lagi, termasuk yang sudah fgConfirmed sebelum ditutup.
export function availableFgToShip(
  mrpId: string,
  vendorProduksi: string,
  results: ProductionResult[],
  kolis: DeliveryKoli[],
  productionGroupMeta: ProductionGroupMeta[],
  maklonPOs: MaklonPO[],
  excludeKoliId?: string,
  source: ShippableKind = "FG"
): AvailableFgRow[] {
  const maklonPO = maklonPOs.find((p) => p.mrpId === mrpId && p.vendorProduksi === vendorProduksi);
  if (maklonPO?.closedAt) return [];
  const produced = fgProducedBySize(mrpId, vendorProduksi, results, source);
  const packed = fgPackedBySize(mrpId, vendorProduksi, kolis, excludeKoliId, source);
  const out: AvailableFgRow[] = [];
  for (const [key, producedQty] of produced.entries()) {
    const [warna, lengan, size, usia] = key.split("|");
    // Tahap 1 saja (fgConfirmedAt) sudah cukup untuk shippable -- lihat catatan di atas fungsi ini.
    if (!productionGroupMetaFor(mrpId + "|" + warna + "|" + lengan, productionGroupMeta)?.fgConfirmedAt) continue;
    const available = producedQty - (packed.get(key) ?? 0);
    if (available > 0) {
      out.push({ warna, lengan: lengan as Lengan, size, usia: (usia || undefined) as Usia | undefined, available });
    }
  }
  return out;
}

/** Roll (ProductionBatch) yang sudah "Tutup Roll" (`closedAt` terisi) tapi BELUM masuk koli
 *  manapun -- dipakai Pengiriman (app/vendor-maklon/pengiriman/page.tsx) sebagai daftar roll FG
 *  yang bisa dipilih vendor untuk mengisi koli baru. 1 roll SELALU dikirim UTUH (dikonfirmasi
 *  user) -- begitu masuk 1 koli (DeliveryKoli.sourceBatchIds), tidak muncul lagi di sini. Rework
 *  TETAP pakai availableFgToShip pool lama di atas (tidak py roll asal, lihat plan HPP per roll).
 *  `excludeKoliId` sama polanya dengan availableFgToShip -- supaya saat EDIT 1 koli, roll yang
 *  SUDAH ada di koli itu sendiri tetap kelihatan (bukan dianggap "sudah terkirim di koli lain").
 *
 *  REVISI (2026-09-09, owner: "ubah agar kunci atau close dulu baru bisa dikirim" -- screenshot
 *  ABU MUDA · PENDEK sudah bisa dipilih di Pengiriman padahal "Selesai Produksi" tahap 1 belum
 *  diklik sama sekali untuk warna itu): dulu roll langsung shippable begitu ditutup, TANPA peduli
 *  status grup warna/lengannya -- beda sendiri dari jalur Rework/sisa FG lama (`availableFgToShip`
 *  di atas) yang SUDAH mewajibkan `fgConfirmedAt` (tahap 1) lebih dulu. Sekarang disamakan: roll
 *  juga baru shippable setelah grup warna/lengannya "Selesai Produksi" (tahap 1) -- BUKAN tahap 2
 *  "Final Produksi" (`doneAt`), yang memang bukan gerbang Pengiriman (lihat halaman Final Produksi
 *  vendor & catatan `mrpIdsWithUnpackedFg`). */
export function closedUnshippedRollsForMrp(
  mrpId: string,
  vendorProduksi: string,
  batches: ProductionBatch[],
  deliveryKolis: DeliveryKoli[],
  maklonPOs: MaklonPO[],
  productionGroupMeta: ProductionGroupMeta[],
  excludeKoliId?: string
): ProductionBatch[] {
  const maklonPO = maklonPOs.find((p) => p.mrpId === mrpId && p.vendorProduksi === vendorProduksi);
  if (maklonPO?.closedAt) return [];
  const shippedElsewhere = new Set(deliveryKolis.filter((k) => k.id !== excludeKoliId).flatMap((k) => k.sourceBatchIds ?? []));
  return batches.filter(
    (b) =>
      b.mrpId === mrpId &&
      b.vendorProduksi === vendorProduksi &&
      b.closedAt &&
      !shippedElsewhere.has(b.id) &&
      productionGroupMetaFor(mrpId + "|" + b.warna + "|" + b.lengan, productionGroupMeta)?.fgConfirmedAt
  );
}

export function mrpIdsWithUnpackedFg(
  vendorProduksi: string,
  results: ProductionResult[],
  kolis: DeliveryKoli[],
  productionGroupMeta: ProductionGroupMeta[],
  maklonPOs: MaklonPO[]
): string[] {
  // Item 20: Reject bukan lagi shippable -- source cuma FG & REWORK.
  const sources: ShippableKind[] = ["FG", "REWORK"];
  const mrpIds = Array.from(new Set(results.filter((r) => r.vendorProduksi === vendorProduksi).map((r) => r.mrpId)));
  return mrpIds.filter((mrpId) =>
    sources.some((source) => availableFgToShip(mrpId, vendorProduksi, results, kolis, productionGroupMeta, maklonPOs, undefined, source).length > 0)
  );
}

/** BUG FIX (2026-09-09, owner: "kenapa yang finish good dan sudah selesai produksi itu tidak
 *  masuk datanya ke halaman pengiriman?"): `mrpIdsWithUnpackedFg` di atas (basis dropdown "Pilih
 *  MRP" DAN badge sidebar Pengiriman) cuma baca `availableFgToShip`/`fgProducedBySize`, yang
 *  SENGAJA mengecualikan hasil roll (`isRollClosureResult`, fix PR #37 -- roll yang belum ditutup
 *  tidak boleh shippable lewat pool umum). Basis shippable UTAMA sejak fitur "HPP per roll"
 *  (migration 0020) justru `closedUnshippedRollsForMrp` (murni `ProductionBatch.closedAt`) --
 *  tapi fungsi itu TIDAK PERNAH diikutkan ke `mrpIdsWithUnpackedFg`. Akibatnya: MRP yang SEMUA
 *  FG-nya lewat jalur roll (paling umum sekarang) tidak akan PERNAH muncul di dropdown/badge
 *  Pengiriman -- roll-nya sendiri sebenarnya sudah shippable, cuma MRP-nya tidak pernah bisa
 *  dipilih karena tidak pernah kelihatan. Dipakai di-UNION dengan `mrpIdsWithUnpackedFg` di kedua
 *  pemanggilnya (pengiriman/page.tsx & lib/shell/badges.ts), bukan menggantikannya -- MRP dengan
 *  rework/sisa FG lama (jalur pool umum) tetap harus ikut muncul juga. */
export function mrpIdsWithClosedRolls(
  vendorProduksi: string,
  batches: ProductionBatch[],
  deliveryKolis: DeliveryKoli[],
  maklonPOs: MaklonPO[],
  productionGroupMeta: ProductionGroupMeta[]
): string[] {
  const candidateMrpIds = Array.from(new Set(batches.filter((b) => b.vendorProduksi === vendorProduksi && b.closedAt).map((b) => b.mrpId)));
  return candidateMrpIds.filter((mrpId) => closedUnshippedRollsForMrp(mrpId, vendorProduksi, batches, deliveryKolis, maklonPOs, productionGroupMeta).length > 0);
}

export type DeliveredQtyRow = { mrpId: string; warna: string; lengan: Lengan; usia?: Usia; qty: number };

function invoiceLineKey(mrpId: string, warna: string, lengan: Lengan, usia?: Usia): string {
  return mrpId + "|" + warna + "|" + lengan + "|" + (usia ?? "");
}

export function deliveredQtyByMrp(vendorProduksi: string, kolis: DeliveryKoli[]): DeliveredQtyRow[] {
  const map = new Map<string, DeliveredQtyRow>();
  for (const k of kolis) {
    if (k.vendorProduksi !== vendorProduksi || !k.deliveredAt) continue;
    for (const it of k.items) {
      const key = invoiceLineKey(k.mrpId, it.warna, it.lengan, it.usia);
      const cur = map.get(key) ?? { mrpId: k.mrpId, warna: it.warna, lengan: it.lengan, usia: it.usia, qty: 0 };
      cur.qty += it.qty;
      map.set(key, cur);
    }
  }
  return Array.from(map.values());
}

export type KoliBreakdownRow = { koliId: string; noKoli: string; deliveredAt?: string; qty: number };

/** Rincian qty per NOMOR KOLI untuk 1 baris "sudah dikirim, belum diinvoice" (mrpId+warna+lengan
 *  +usia) — dipakai tombol "Detail →" di tabel "Create Invoice" (Invoice & Payment, Vendor
 *  Produksi, feedback 2026-09-09: "Vendor bisa klik detail nanti data per row untuk lihat detail
 *  qty per nomor koli di warna itu"). Predikat filter/jumlah PERSIS SAMA seperti
 *  `deliveredQtyByMrp` (basis angka yang sudah tampil di kolom itu) supaya total baris detail di
 *  sini SELALU rekonsil pas dengan angka "sudah dikirim, belum diinvoice" yang sudah ada — bukan
 *  definisi baru. */
export function koliBreakdownForLine(mrpId: string, warna: string, lengan: Lengan, usia: Usia | undefined, vendorProduksi: string, kolis: DeliveryKoli[]): KoliBreakdownRow[] {
  const out: KoliBreakdownRow[] = [];
  for (const k of kolis) {
    if (k.vendorProduksi !== vendorProduksi || k.mrpId !== mrpId || !k.deliveredAt) continue;
    const qty = k.items.filter((it) => it.warna === warna && it.lengan === lengan && it.usia === usia).reduce((s, it) => s + it.qty, 0);
    if (qty > 0) out.push({ koliId: k.id, noKoli: k.noKoli, deliveredAt: k.deliveredAt, qty });
  }
  return out;
}

export function invoicedQtyByMrp(vendorProduksi: string, invoices: VendorInvoice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.vendorProduksi !== vendorProduksi || inv.status === "REVISION") continue;
    for (const line of inv.lines) {
      const key = invoiceLineKey(line.mrpId, line.warna, line.lengan, line.usia);
      map.set(key, (map.get(key) ?? 0) + line.qty);
    }
  }
  return map;
}

export type InvoiceableLine = { mrpId: string; warna: string; lengan: Lengan; usia?: Usia; uninvoicedQty: number };

export function invoiceableMrpIds(vendorProduksi: string, kolis: DeliveryKoli[], invoices: VendorInvoice[]): InvoiceableLine[] {
  const delivered = deliveredQtyByMrp(vendorProduksi, kolis);
  const invoiced = invoicedQtyByMrp(vendorProduksi, invoices);
  const out: InvoiceableLine[] = [];
  for (const row of delivered) {
    const key = invoiceLineKey(row.mrpId, row.warna, row.lengan, row.usia);
    const uninvoicedQty = row.qty - (invoiced.get(key) ?? 0);
    if (uninvoicedQty > 0) out.push({ mrpId: row.mrpId, warna: row.warna, lengan: row.lengan, usia: row.usia, uninvoicedQty });
  }
  return out;
}

// ===== Invoice Maklon basis PLANNED (bukan delivered) — hasil konsultasi tim produksi =====
// Invoice sekarang diajukan untuk SELURUH qty planned (PO), bukan cuma yang sudah delivery,
// begitu delivery PERTAMA sudah mulai. Retensi sudah dihapus dari alur (keputusan bisnis
// terbaru) — begitu Procurement approve invoice, Finance tinggal bayar lunas sekaligus, lihat
// lib/mrp/store.ts `payVendorInvoice`.

/** True kalau minimal 1 koli untuk mrpId+vendor ini sudah delivered — syarat invoice mulai
 *  boleh diajukan (bukan langsung begitu PO approved). */
export function hasDeliveryStarted(mrpId: string, vendorProduksi: string, deliveryKolis: DeliveryKoli[]): boolean {
  return deliveryKolis.some((k) => k.mrpId === mrpId && k.vendorProduksi === vendorProduksi && k.deliveredAt);
}

/** Basis qty invoice yang baru: qty PLANNED dari aduanRows (sumber yang sama dipakai
 *  sendPoToFinance saat PO pertama dibuat — otomatis reflect qty TERKINI kalau ada pembatalan
 *  lewat closePoWithReason, karena qty planned MaklonPO sendiri sudah dikurangi di sana),
 *  DIGEMBOK per-MRP oleh hasDeliveryStarted (MRP yang belum ada delivery sama sekali tidak
 *  muncul). Bentuk output sama seperti deliveredQtyByMrp supaya dipakai pola yang sama di
 *  invoiceableMrpIdsFullQty. */
export function plannedQtyByMrp(vendorProduksi: string, mrpDetails: MrpDetail[], deliveryKolis: DeliveryKoli[]): DeliveredQtyRow[] {
  const map = new Map<string, DeliveredQtyRow>();
  for (const detail of mrpDetails) {
    const rows = detail.aduanRows.filter((a) => a.vendor === vendorProduksi);
    if (rows.length === 0 || !hasDeliveryStarted(detail.mrp.id, vendorProduksi, deliveryKolis)) continue;
    for (const a of rows) {
      const key = invoiceLineKey(detail.mrp.id, a.warna, a.lengan, undefined);
      const cur = map.get(key) ?? { mrpId: detail.mrp.id, warna: a.warna, lengan: a.lengan, usia: undefined, qty: 0 };
      cur.qty += a.qty;
      map.set(key, cur);
    }
  }
  return Array.from(map.values());
}

/** Sama seperti invoiceableMrpIds tapi basis PLANNED, bukan delivered — dipakai
 *  InvoiceVendorPanel menggantikan invoiceableMrpIds. "Sudah diinvoice" dihitung usia-agnostic
 *  (gabung semua usia jadi satu, TIDAK exact-match ke invoicedQtyByMrp) supaya invoice LAMA yang
 *  kebetulan punya usia ter-tag (dari basis delivered sebelum perubahan ini) tetap kehitung
 *  dengan benar, tidak dianggap "belum diinvoice" lagi gara-gara key usia beda. */
export function invoiceableMrpIdsFullQty(
  vendorProduksi: string,
  mrpDetails: MrpDetail[],
  deliveryKolis: DeliveryKoli[],
  invoices: VendorInvoice[]
): InvoiceableLine[] {
  const planned = plannedQtyByMrp(vendorProduksi, mrpDetails, deliveryKolis);
  const invoicedByKey = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.vendorProduksi !== vendorProduksi || inv.status === "REVISION") continue;
    for (const line of inv.lines) {
      const key = line.mrpId + "|" + line.warna + "|" + line.lengan;
      invoicedByKey.set(key, (invoicedByKey.get(key) ?? 0) + line.qty);
    }
  }
  const out: InvoiceableLine[] = [];
  for (const row of planned) {
    const key = row.mrpId + "|" + row.warna + "|" + row.lengan;
    const uninvoicedQty = row.qty - (invoicedByKey.get(key) ?? 0);
    if (uninvoicedQty > 0) out.push({ mrpId: row.mrpId, warna: row.warna, lengan: row.lengan, usia: undefined, uninvoicedQty });
  }
  return out;
}

/** True kalau SEMUA baris invoice ini sudah delivery penuh (qty delivered >= qty diinvoice per
 *  mrpId+warna+lengan) — MURNI indikator informasi di halaman Payment Maklon sekarang (retensi
 *  sudah dihapus dari alur, jadi ini tidak lagi menggembok pembayaran apa pun, lihat
 *  payVendorInvoice di lib/mrp/store.ts). Delivered dihitung usia-agnostic (gabung semua usia)
 *  dengan alasan sama seperti invoiceableMrpIdsFullQty. */
export function vendorInvoiceFullyDelivered(invoice: VendorInvoice, deliveryKolis: DeliveryKoli[]): boolean {
  const delivered = deliveredQtyByMrp(invoice.vendorProduksi, deliveryKolis);
  const deliveredByKey = new Map<string, number>();
  for (const r of delivered) {
    const key = r.mrpId + "|" + r.warna + "|" + r.lengan;
    deliveredByKey.set(key, (deliveredByKey.get(key) ?? 0) + r.qty);
  }
  return invoice.lines.every((l) => (deliveredByKey.get(l.mrpId + "|" + l.warna + "|" + l.lengan) ?? 0) >= l.qty);
}

export function mrpMetaFor(mrpId: string, mrpDetails: MrpDetail[], staticMrps: Mrp[]): Mrp | undefined {
  return mrpDetails.find((d) => d.mrp.id === mrpId)?.mrp ?? staticMrps.find((m) => m.id === mrpId);
}

// ===== Dashboard end-to-end progress (MRP -> vendor -> warna) =====

export type MrpProgressStage = {
  po: number;
  invoice: number;
  paidMaterial: number;
  rcvMaterial: number;
  cutting: number;
  fg: number;
  delivery: number;
};

const PAID_OR_LATER: RawMaterialInvoice["status"][] = ["PAID", "DELIVERY", "RECEIVING", "WAITING_PRODUCTION", "PRODUCTION_DONE"];

function emptyProgressStage(): MrpProgressStage {
  return { po: 0, invoice: 0, paidMaterial: 0, rcvMaterial: 0, cutting: 0, fg: 0, delivery: 0 };
}

function sumProgressStages(rows: MrpProgressStage[]): MrpProgressStage {
  return rows.reduce(
    (acc, r) => ({
      po: acc.po + r.po,
      invoice: acc.invoice + r.invoice,
      paidMaterial: acc.paidMaterial + r.paidMaterial,
      rcvMaterial: acc.rcvMaterial + r.rcvMaterial,
      cutting: acc.cutting + r.cutting,
      fg: acc.fg + r.fg,
      delivery: acc.delivery + r.delivery,
    }),
    emptyProgressStage()
  );
}

export type MrpProgressWarnaRow = MrpProgressStage & { warna: string; lengan: Lengan };
export type MrpProgressVendorRow = MrpProgressStage & { vendorProduksi: string; warnaRows: MrpProgressWarnaRow[] };
export type MrpProgressRow = MrpProgressStage & { mrpId: string; mrpQty: number; vendorRows: MrpProgressVendorRow[] };

export function mrpProgressRows(
  mrpDetails: MrpDetail[],
  staticMrps: Mrp[],
  materialPOs: MaterialPO[],
  maklonPOs: MaklonPO[],
  invoices: RawMaterialInvoice[],
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  deliveryKolis: DeliveryKoli[]
): MrpProgressRow[] {
  const mrpIds = Array.from(new Set([...mrpDetails.map((d) => d.mrp.id), ...maklonPOs.map((p) => p.mrpId)]));

  return mrpIds.map((mrpId) => {
    const mrp = mrpMetaFor(mrpId, mrpDetails, staticMrps);
    const detail = mrpDetailFor(mrpId, mrpDetails);
    const vendors = Array.from(new Set(maklonPOs.filter((p) => p.mrpId === mrpId).map((p) => p.vendorProduksi)));

    const vendorRows: MrpProgressVendorRow[] = vendors.map((vendorProduksi) => {
      const aduanRowsForVendor = (detail?.aduanRows ?? []).filter((a) => a.vendor === vendorProduksi);
      const warnaKeys = Array.from(new Set(aduanRowsForVendor.map((a) => a.warna + "|" + a.lengan)));

      const warnaRows: MrpProgressWarnaRow[] = warnaKeys.map((key) => {
        const [warna, lengan] = key.split("|") as [string, Lengan];
        const po = aduanRowsForVendor.filter((a) => a.warna === warna && a.lengan === lengan).reduce((s, a) => s + a.qty, 0);

        const matPOsForColor = materialPOs.filter(
          (p) => p.mrpId === mrpId && p.vendorProduksi === vendorProduksi && p.colorBreakdown.some((c) => c.warna === warna && c.lengan === lengan)
        );
        const invoiceRoll = matPOsForColor.reduce((s, p) => s + (p.invoicedByColor[key] ?? 0), 0);

        const invoicesForMrpVendor = invoices.filter((i) => i.mrpId === mrpId && i.destinationVendor === vendorProduksi);
        const paidMaterial = invoicesForMrpVendor
          .filter((i) => PAID_OR_LATER.includes(i.status))
          .reduce((s, i) => s + i.colorEntries.filter((c) => c.warna === warna && c.lengan === lengan).reduce((a, c) => a + c.rolls.length, 0), 0);

        const rcvMaterial = receivedRollCountForColor(mrpId, vendorProduksi, warna, lengan, invoices);

        const cutting = productionBatches
          .filter((b) => b.mrpId === mrpId && b.vendorProduksi === vendorProduksi && b.warna === warna && b.lengan === lengan)
          .reduce((s, b) => s + b.qtyRoll, 0);

        const groupKey = mrpId + "|" + warna + "|" + lengan;
        const fg = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", productionResults)).reduce((a, b) => a + b, 0);

        const delivery = deliveryKolis
          .filter((k) => k.mrpId === mrpId && k.vendorProduksi === vendorProduksi && k.deliveredAt)
          .flatMap((k) => k.items)
          .filter((it) => it.warna === warna && it.lengan === lengan && (it.kind ?? "FG") === "FG")
          .reduce((s, it) => s + it.qty, 0);

        return { warna, lengan, po, invoice: invoiceRoll, paidMaterial, rcvMaterial, cutting, fg, delivery };
      });

      const vendorTotal = sumProgressStages(warnaRows);
      const maklonPo = maklonPOs.find((p) => p.mrpId === mrpId && p.vendorProduksi === vendorProduksi);
      return { vendorProduksi, warnaRows, ...vendorTotal, po: maklonPo?.qty ?? vendorTotal.po };
    });

    const mrpTotal = sumProgressStages(vendorRows);
    return { mrpId, mrpQty: mrp?.qty ?? mrpTotal.po, vendorRows, ...mrpTotal };
  });
}

export function invoiceCategoryLabel(mrp: Mrp | undefined, usia?: Usia): string {
  if (!mrp) return "—";
  if (usia !== "KIDS") return mrp.kategori;
  const rest = mrp.kategori.split(" ").slice(1).join(" ");
  return rest ? `KIDS ${rest}` : `KIDS ${mrp.kategori}`;
}

export function vendorInvoiceAdjustmentTotal(inv: VendorInvoice, kind: "DENDA" | "REWARD"): number {
  return (inv.adjustments ?? []).filter((a) => a.kind === kind).reduce((s, a) => s + a.amount, 0);
}

export function vendorInvoiceFinalAmount(inv: VendorInvoice): number {
  const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
  const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
  return inv.netTagihan - denda + reward;
}

export function vendorInvoiceTotalPaid(inv: VendorInvoice): number {
  const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
  const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
  return inv.totalTagihan - denda + reward;
}

/** Retensi sudah dihapus dari alur — pembayaran sekarang cuma 1 tahap (lunas penuh sekaligus),
 *  jadi status-nya biner saja: sudah dibayar atau belum. */
export function vendorInvoicePaymentStatus(inv: VendorInvoice): { label: string; tone: "neutral" | "warning" | "success" | "info" } {
  if (inv.status === "PAID") return { label: "Lunas", tone: "success" };
  return { label: "Belum dibayar", tone: "warning" };
}

export type ProductionYieldRow = {
  warna: string;
  lengan: Lengan;
  size?: string;
  target: number;
  cutting: number;
  finishGood: number;
  reject: number;
  rework: number;
  yieldPct: number;
};

/** Total reject GRUP INI yang sudah dirework jadi baju -- dihitung dari sisi ASAL (deduksi
 *  reject-nya, lewat reworkedAwayBySize), BUKAN dari sisi hasil FG-nya. Ini penting karena rework
 *  boleh lintas lengan (reject PANJANG -> baju PENDEK, lihat reworkRejectSizeAction) sehingga FG
 *  hasil rework itu tercatat dengan groupKey TUJUAN yang beda dari groupKey grup ini -- kalau
 *  dihitung dari sisi FG (groupKey tujuan) maka rework lintas-lengan salah dianggap 0 padahal
 *  reject-nya sudah berkurang. Dipakai juga sebagai pengaman `undoFgConfirmAction` (menolak buka
 *  kunci kalau reject grup ini sudah dirework), jadi harus benar-benar mencerminkan sisi asal. */
export function reworkQtyForGroup(groupKey: string, results: ProductionResult[]): number {
  return Object.values(reworkedAwayBySize(groupKey, results)).reduce((a, b) => a + b, 0);
}

/** Total reject yang dibuang jadi sisa/waste (majun, kain perca) — TIDAK bisa dirework jadi baju,
 *  beda dari reworkQtyForGroup. Dijumlah langsung dari entri kind "WASTE" (positif), bukan dari
 *  deduksi REJECT-nya (itu negatif, cuma buat ngurangi "sisa reject" — lihat wastedAwayBySize). */
export function wasteQtyForGroup(groupKey: string, results: ProductionResult[]): number {
  return results
    .filter((r) => r.groupKey === groupKey && r.kind === "WASTE")
    .reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0);
}

export function rejectGrossForGroup(groupKey: string, results: ProductionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.kind !== "REJECT" || r.groupKey !== groupKey || r.note) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) out[size] = (out[size] ?? 0) + qty;
  }
  return out;
}

/** Per-size: berapa reject yang SUDAH dipindah ke rework (dari `reworkRejectSize`, yang menulis
 *  entri REJECT ber-note dengan sizeQty negatif untuk size ASAL). Dipakai bareng
 *  `rejectGrossForGroup` + `cumulativeSizeQtyForGroup(..., "REJECT", ...)` di tab Reject supaya
 *  "reject tercatat / sudah dirework / sisa reject" kelihatan sekaligus tanpa pindah ke tab
 *  Rework terpisah. */
export function reworkedAwayBySize(groupKey: string, results: ProductionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    // Note dicek prefix "Rework" secara eksplisit — sejak ada wasteRejectSizeAction, deduksi
    // REJECT ber-note juga bisa berarti "dibuang ke sisa/waste" (note diawali "Waste"), bukan
    // cuma rework, jadi tidak cukup cek `!r.note` saja lagi (lihat wastedAwayBySize).
    if (r.kind !== "REJECT" || r.groupKey !== groupKey || !r.note?.startsWith("Rework")) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      if (qty < 0) out[size] = (out[size] ?? 0) + -qty;
    }
  }
  return out;
}

// Item 19 (feedback batch 2026-09-04): "Buang ke Sisa" dihapus dari UI & flow — `wastedAwayBySize`
// (dulu dipakai kolom "Sisa/Waste" di production-result-panel.tsx/production-final-tab.tsx) sudah
// tidak dipakai lagi, jadi dihapus di sini juga. `wasteQtyForGroup` di atas SENGAJA DIPERTAHANKAN
// — masih dipakai sebagai guard di undoFgConfirmAction (actions.ts) dan baris WASTE lama (legacy)
// tetap mungkin ada di DB. Enum "WASTE" (ProductionResultKind, production_kind_t) juga tetap ada,
// tidak dihapus (lihat catatan di actions.ts wasteRejectSizeAction — action-nya sendiri dihapus,
// tapi nilai enum & data historis dibiarkan apa adanya, tidak ada migration baru untuk ini).

// Item 18.5 (feedback batch 2026-09-04): "target" (rencana PO/MRP) dan "cutting" (hasil cutting
// AKTUAL) sekarang DIPISAH jadi 2 kolom ("Qty PO" vs "Hasil Cutting") di invoice-vendor-panel.tsx
// & invoice-vendor-review-panel.tsx, bukan disamakan seperti dulu — yieldPct dihitung dari cutting
// aktual (fg/cutting), bukan dari target rencana lagi.
export function productionYieldByWarna(mrpId: string, vendorProduksi: string, mrpDetails: MrpDetail[], batches: ProductionBatch[], results: ProductionResult[]): ProductionYieldRow[] {
  const groups = cutWarnaLenganGroups(mrpId, vendorProduksi, batches);
  return groups.map((g) => {
    const target = Object.values(targetSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, batches)).reduce((a, b) => a + b, 0);
    const cutting = Object.values(cuttingSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, batches)).reduce((a, b) => a + b, 0);
    const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
    const fg = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", results)).reduce((a, b) => a + b, 0);
    const reject = Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", results)).reduce((a, b) => a + b, 0);
    const rework = reworkQtyForGroup(groupKey, results);
    return { warna: g.warna, lengan: g.lengan, target, cutting, finishGood: fg, reject, rework, yieldPct: cutting > 0 ? (fg / cutting) * 100 : 0 };
  });
}

/** Per size: Finish Good yang berasal dari REWORK (reject dipotong ulang jadi baju size/lengan
 *  lain) untuk 1 grup -- subset dari cumulativeSizeQtyForGroup(groupKey,"FG",...), dibedakan dari
 *  Finish Good "murni" (hasil cutting langsung) lewat isReworkResult (note diawali "Rework
 *  dari..."). Dipakai buat kasih label mana Finish Good asli, mana hasil rework -- lihat juga
 *  fgMurniAndReworkForGroup untuk versi totalnya. */
export function reworkBySizeForGroup(groupKey: string, results: ProductionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.groupKey !== groupKey || r.kind !== "FG" || !isReworkResult(r)) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) out[size] = (out[size] ?? 0) + qty;
  }
  return out;
}

/** Total Finish Good 1 grup, dipecah "murni" (hasil cutting langsung) vs "dari rework" (reject
 *  yang dipotong ulang jadi baju) -- murni + rework = totalFg dari cumulativeSizeQtyForGroup.
 *  Contoh kasus yang diminta: Finish Good murni 100, lalu 3 reject di-rework jadi baju -> total
 *  Finish Good tampil 103, dengan rincian "100 murni + 3 dari rework". */
export function fgMurniAndReworkForGroup(groupKey: string, results: ProductionResult[]): { murni: number; rework: number } {
  let murni = 0;
  let rework = 0;
  for (const r of results) {
    if (r.groupKey !== groupKey || r.kind !== "FG") continue;
    const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
    if (isReworkResult(r)) rework += qty;
    else murni += qty;
  }
  return { murni, rework };
}

export function productionYieldBySize(mrpId: string, warna: string, lengan: Lengan, mrpDetails: MrpDetail[], batches: ProductionBatch[], results: ProductionResult[]): ProductionYieldRow[] {
  const target = targetSizesForGroup(mrpId, warna, lengan, mrpDetails, batches);
  const cutting = cuttingSizesForGroup(mrpId, warna, lengan, mrpDetails, batches);
  const groupKey = mrpId + "|" + warna + "|" + lengan;
  const fg = cumulativeSizeQtyForGroup(groupKey, "FG", results);
  const reject = cumulativeSizeQtyForGroup(groupKey, "REJECT", results);
  const rework = reworkBySizeForGroup(groupKey, results);
  const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(cutting), ...Object.keys(fg), ...Object.keys(reject), ...Object.keys(rework)]));
  return sizes.map((size) => {
    const t = target[size] ?? 0;
    const c = cutting[size] ?? 0;
    const f = fg[size] ?? 0;
    const r = reject[size] ?? 0;
    const rw = rework[size] ?? 0;
    return { warna, lengan, size, target: t, cutting: c, finishGood: f, reject: r, rework: rw, yieldPct: c > 0 ? (f / c) * 100 : 0 };
  });
}

export function vendorInvoiceBadge(status: VendorInvoice["status"]) {
  const map: Record<VendorInvoice["status"], { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" | "rework" }> = {
    SUBMITTED: { label: "SUBMITTED", tone: "warning" },
    REVISION: { label: "REVISI", tone: "danger" },
    APPROVED: { label: "APPROVED", tone: "info" },
    PAID: { label: "PAID", tone: "success" },
  };
  return map[status];
}

// ===== HPP (harga pokok penjualan) per item — dipakai bareng oleh export Lampiran Invoice
// (Procurement > Invoice Vendor) dan halaman Laporan HPP, supaya rumusnya satu sumber saja. =====

const HPP_LENGAN_ABBR: Record<Lengan, string> = { PENDEK: "PDK", PANJANG: "PJG" };

function materialCostForWarna(warna: string, vendorProduksi: string, rawInvoices: RawMaterialInvoice[]) {
  let rollCount = 0;
  let totalNetWeight = 0;
  let hargaBahanTotal = 0;
  for (const rawInv of rawInvoices) {
    if (rawInv.destinationVendor !== vendorProduksi) continue;
    for (const c of rawInv.colorEntries) {
      if (c.warna !== warna) continue;
      rollCount += c.rolls.length;
      // BUG FIX 2026-09-07: `hargaPerRoll` (nama field historis, ColorEntry.hargaPerRoll) ITU
      // SEBENARNYA HARGA PER KG -- lihat label input aslinya ("Harga / kg") di
      // paying-voucher-wizard.tsx, dan cara Payment/PV menghitung subtotal (harga x TOTAL KG,
      // bukan x jumlah roll). Baris ini dulu salah kali jumlah roll (`c.rolls.length`, angka
      // kecil mis. 4-8) alih-alih total kg (`c.rolls` isinya berat gross per roll dalam kg, bisa
      // ~25kg/roll) -- akibatnya hargaBahanTotal (dipakai Laporan HPP & fallback pool HPP per
      // roll) understated sampai puluhan kali lipat. Gross kg (bukan net hasil timbang ulang)
      // dipakai supaya konsisten dengan nilai yang benar-benar ditagih ke supplier (PV/invoice).
      hargaBahanTotal += c.hargaPerRoll * c.rolls.reduce((s, w) => s + w, 0);
      const receipts = rawInv.rollReceipts[c.warna + "|" + c.lengan] ?? [];
      c.rolls.forEach((grossKg, idx) => {
        totalNetWeight += receipts[idx]?.netKg ?? grossKg;
      });
    }
    for (const b of rawInv.addBuys) {
      if (b.warna === warna) hargaBahanTotal += b.totalHarga;
    }
  }
  return { rollCount, totalNetWeight, hargaBahanTotal };
}

/** Cari roll bahan baku ASAL 1 roll produksi (ProductionBatch) lewat pencocokan `codeRoll` ke
 *  `RollReceipt.codeRoll` (diisi Good Receive/Cutting) -- dipakai hppRowsForInvoicePerRoll untuk
 *  mengambil harga & berat ROLL INI SPESIFIK (bisa beda dari roll lain kalau ini roll pengganti
 *  klaim retur, lihat createClaimReplacementInvoiceAction), persis pendekatan "Detail HPP" di
 *  Template Excel Finance -- beda dari materialCostForWarna di atas yang MENGUMPULKAN semua roll
 *  1 warna+lengan jadi satu pool. Return null kalau tidak ketemu (roll belum py codeRoll, atau
 *  data lama sebelum fitur pencocokan ini ada) -- caller fallback ke rata-rata pool
 *  (materialCostForWarna).
 *
 *  `hargaPerKg` (nama field asli di ColorEntry: `hargaPerRoll`, TAPI ITU HARGA PER KG -- lihat
 *  catatan bug fix di materialCostForWarna) dikembalikan APA ADANYA (belum dikali berat) --
 *  caller yang mengalikan dengan `grossKg` roll ini sendiri untuk dapat total biaya roll itu. */
function findRawMaterialRollForBatch(batch: ProductionBatch, rawInvoices: RawMaterialInvoice[]): { hargaPerKg: number; grossKg: number; netKg: number } | null {
  if (!batch.codeRoll) return null;
  for (const rawInv of rawInvoices) {
    if (rawInv.destinationVendor !== batch.vendorProduksi) continue;
    for (const c of rawInv.colorEntries) {
      if (c.warna !== batch.warna || c.lengan !== batch.lengan) continue;
      const receipts = rawInv.rollReceipts[c.warna + "|" + c.lengan] ?? [];
      const idx = receipts.findIndex((r) => r?.codeRoll === batch.codeRoll);
      if (idx === -1) continue;
      const grossKg = c.rolls[idx] ?? 0;
      return { hargaPerKg: c.hargaPerRoll, grossKg, netKg: receipts[idx]?.netKg ?? grossKg };
    }
  }
  return null;
}

export type HppRow = {
  invoiceId: string;
  vendorProduksi: string;
  /** No koli pengiriman asal baris ini -- diisi kalau baris ini bisa ditelusuri ke SATU koli
   *  spesifik (baris roll & baris rework baru, lib/mrp/derive.ts hppRowsForInvoicePerRoll).
   *  Kosong untuk baris pool lama (hppRowsForInvoice) yang menggabungkan >1 koli sekaligus. */
  noKoli?: string;
  mrpId: string;
  mrpLabel: string;
  warna: string;
  lengan: Lengan;
  item: string;
  jenis: string;
  qtyPo: number;
  cutting: number;
  fg: number;
  reject: number;
  rework: number;
  statusLabel: string;
  yieldPct: number;
  maklonRate: number;
  jumlahRoll: number;
  totalBeratBahan: number;
  faktorProduksi: number;
  aktualBeratTerpakai: number;
  persentase: number;
  hargaBahanTotal: number;
  cogsBahan: number;
  cogsBahanPerItem: number;
  pemotonganDenda: number;
  biayaProduksiTotal: number;
  biayaProduksiPerItem: number;
  ongkirPerItem: number;
  totalOngkirRow: number;
  hppPerItem: number;
};

/** Ongkir 1 invoice vendor — dihitung OTOMATIS dari koli pengiriman (deliveryKolis) milik
 *  vendor+MRP invoice ini, pakai tarif tier ekspedisi (EKSPEDISI_RATES via ekspedisiPrice)
 *  berdasarkan berat koli AKTUAL. Sebelumnya field ini diisi manual oleh Finance padahal data
 *  berat+ekspedisi-nya sudah ada dari halaman Pengiriman vendor — sekarang selalu dihitung LIVE
 *  dari data terbaru (bukan snapshot yang disimpan), jadi otomatis ikut berubah kalau delivery-nya
 *  berubah (koli baru ditambah, berat direvisi, dst). Koli yang beratnya belum diisi vendor
 *  (beratKoli undefined) dianggap 0 sampai ditimbang. */
export function autoOngkirForInvoice(inv: VendorInvoice, deliveryKolis: DeliveryKoli[]): number {
  const mrpIdsInInvoice = Array.from(new Set(inv.lines.map((l) => l.mrpId)));
  return deliveryKolis
    .filter((k) => k.vendorProduksi === inv.vendorProduksi && mrpIdsInInvoice.includes(k.mrpId))
    .reduce((sum, k) => sum + ekspedisiPrice(k.ekspedisi, k.beratKoli ?? 0), 0);
}

export function hppRowsForInvoice(
  inv: VendorInvoice,
  ongkirTotal: number,
  mrpDetails: MrpDetail[],
  staticMrps: Mrp[],
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  rawInvoices: RawMaterialInvoice[],
  deliveryKolis: DeliveryKoli[]
): HppRow[] {
  const mrpIdsInInvoice = Array.from(new Set(inv.lines.map((l) => l.mrpId)));
  const totalPcsInKoli = deliveryKolis
    .filter((k) => k.vendorProduksi === inv.vendorProduksi && mrpIdsInInvoice.includes(k.mrpId))
    .flatMap((k) => k.items)
    .reduce((s, it) => s + it.qty, 0);

  const denda = vendorInvoiceAdjustmentTotal(inv, "DENDA");
  const reward = vendorInvoiceAdjustmentTotal(inv, "REWARD");
  const netAdjustment = reward - denda;

  type Draft = {
    mrpId: string;
    mrpLabel: string;
    warna: string;
    lengan: Lengan;
    item: string;
    jenis: string;
    qtyPo: number;
    cutting: number;
    fg: number;
    reject: number;
    rework: number;
    statusLabel: string;
    yieldPct: number;
    maklonRate: number;
    jumlahRoll: number;
    totalBeratBahan: number;
    faktorProduksi: number;
    aktualBeratTerpakai: number;
    hargaBahanTotal: number;
    groupKey: string;
  };

  const drafts: Draft[] = [];
  for (const line of inv.lines) {
    const mrp = mrpMetaFor(line.mrpId, mrpDetails, staticMrps);
    const groupKey = line.mrpId + "|" + line.warna + "|" + line.lengan;
    const bySize = productionYieldBySize(line.mrpId, line.warna, line.lengan, mrpDetails, productionBatches, productionResults);
    const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
    const target = targetDoneProduksiForGroup(line.mrpId, inv.vendorProduksi, line.warna, rawInvoices);
    const status = productionStatusFromDates(target, meta?.doneAt);
    const statusLabel = status ? (status.label === "DELAY" ? "Delay" : status.label === "ONTIME" ? "Ontime" : "Lebih Cepat") : "—";
    const jumlahRoll = productionBatches
      .filter((b) => b.mrpId === line.mrpId && b.warna === line.warna && b.lengan === line.lengan)
      .reduce((s, b) => s + b.qtyRoll, 0);
    const { totalNetWeight, hargaBahanTotal: hargaBahanTotalGroup } = materialCostForWarna(line.warna, inv.vendorProduksi, rawInvoices);

    // `bySize[].finishGood` (dari productionYieldBySize) itu total FG KUMULATIF sepanjang umur
    // grup warna/lengan ini — BUKAN qty yang ditagih di invoice ini secara khusus. Satu grup bisa
    // ditagih lewat BEBERAPA VendorInvoice terpisah (dipecah bertahap karena dibatasi kapasitas
    // vendor per invoice, lihat invoice-vendor-panel.tsx) — kalau fg & hargaBahanTotal dipakai
    // apa adanya di sini, tiap invoice yang menagih grup yang sama akan melaporkan BIAYA PRODUKSI
    // & COGS BAHAN SEBESAR GRUP UTUH itu berulang, dobel-hitung tiap kali grupnya muncul di
    // invoice lain (total Laporan HPP jadi kelipatan N kalau grup ditagih N kali). `lineShare` =
    // proporsi qty yang DITAGIH invoice ini (`line.qty`) dari total FG grup — dipakai untuk
    // menyusutkan fg per size & porsi biaya bahan supaya masing-masing invoice cuma melaporkan
    // porsinya sendiri (jumlah semua invoice untuk grup yang sama akan kembali pas ke totalnya).
    const groupTotalFg = bySize.reduce((s, x) => s + x.finishGood, 0);
    const lineShare = groupTotalFg > 0 ? Math.min(1, line.qty / groupTotalFg) : 0;
    const hargaBahanTotal = hargaBahanTotalGroup * lineShare;

    for (const s of bySize) {
      const beratBahanPerPc = s.target > 0 ? totalNetWeight / s.target : 0;
      const faktorProduksi = s.target > 0 ? s.finishGood / s.target : 0;
      const aktualBeratTerpakai = faktorProduksi * beratBahanPerPc;
      drafts.push({
        mrpId: line.mrpId,
        mrpLabel: `${line.mrpId} ${mrp?.kategori ?? ""}`.trim(),
        warna: line.warna,
        lengan: line.lengan,
        item: `${line.warna} ${HPP_LENGAN_ABBR[line.lengan]} ${s.size}`,
        jenis: `${line.lengan} ${s.size}`,
        qtyPo: s.target,
        cutting: s.cutting,
        fg: s.finishGood * lineShare,
        reject: s.reject,
        rework: s.rework,
        statusLabel,
        yieldPct: s.yieldPct,
        maklonRate: line.ratePerPc,
        jumlahRoll,
        totalBeratBahan: totalNetWeight,
        faktorProduksi,
        aktualBeratTerpakai,
        hargaBahanTotal,
        groupKey,
      });
    }
  }

  const fgTotalInvoice = drafts.reduce((s, d) => s + d.fg, 0);
  const aktualSumByGroup = new Map<string, number>();
  for (const d of drafts) aktualSumByGroup.set(d.groupKey, (aktualSumByGroup.get(d.groupKey) ?? 0) + d.aktualBeratTerpakai);
  const ongkirPerPc = totalPcsInKoli > 0 ? ongkirTotal / totalPcsInKoli : 0;

  return drafts.map((d) => {
    const aktualSum = aktualSumByGroup.get(d.groupKey) ?? 0;
    const persentase = aktualSum > 0 ? d.aktualBeratTerpakai / aktualSum : 0;
    const cogsBahan = persentase * d.hargaBahanTotal;
    const cogsBahanPerItem = d.fg > 0 ? cogsBahan / d.fg : 0;
    const pemotonganDenda = fgTotalInvoice > 0 ? netAdjustment * (d.fg / fgTotalInvoice) : 0;
    const biayaProduksiTotal = d.maklonRate * d.fg + pemotonganDenda;
    const biayaProduksiPerItem = d.fg > 0 ? biayaProduksiTotal / d.fg : d.maklonRate;
    const totalOngkirRow = ongkirPerPc * d.fg;
    const hppPerItem = biayaProduksiPerItem + cogsBahanPerItem + ongkirPerPc;
    return {
      invoiceId: inv.id,
      vendorProduksi: inv.vendorProduksi,
      mrpId: d.mrpId,
      mrpLabel: d.mrpLabel,
      warna: d.warna,
      lengan: d.lengan,
      item: d.item,
      jenis: d.jenis,
      qtyPo: d.qtyPo,
      cutting: d.cutting,
      fg: d.fg,
      reject: d.reject,
      rework: d.rework,
      statusLabel: d.statusLabel,
      yieldPct: d.yieldPct,
      maklonRate: d.maklonRate,
      jumlahRoll: d.jumlahRoll,
      totalBeratBahan: d.totalBeratBahan,
      faktorProduksi: d.faktorProduksi,
      aktualBeratTerpakai: d.aktualBeratTerpakai,
      persentase,
      hargaBahanTotal: d.hargaBahanTotal,
      cogsBahan,
      cogsBahanPerItem,
      pemotonganDenda,
      biayaProduksiTotal,
      biayaProduksiPerItem,
      ongkirPerItem: ongkirPerPc,
      totalOngkirRow,
      hppPerItem,
    };
  });
}

/** HPP per ROLL (Revisi 2026-09-07, sesuai Template HPP.xlsx Finance & plan "HPP per roll") --
 *  menggantikan pemakaian hppRowsForInvoice lama di app/finance/laporan-hpp/page.tsx. Beda dari
 *  hppRowsForInvoice (yang MENGUMPULKAN semua roll 1 warna+lengan jadi satu pool lalu
 *  mengalokasikan ulang ke size lewat heuristik yield), fungsi ini menelusuri biaya SAMPAI KE ROLL
 *  SPESIFIK (ProductionBatch yang sudah "Tutup Roll" & masuk 1 koli) -- harga bahan roll itu
 *  (findRawMaterialRollForBatch) dibagi rata ke KEDUA size hasil aduan-pola roll itu (blended,
 *  formula sama persis Excel: R = harga roll / SUM(fg kedua size)), lalu ongkir dibagi rata pcs
 *  koli itu -- diambil dari DeliveryKoli.ongkirBatch KALAU diisi manual (nilai riil dari invoice
 *  ekspedisi), kalau tidak fallback ke ekspedisiPrice(ekspedisi, beratKoli) (tarif standar x berat,
 *  formula sama seperti hppRowsForInvoice lama -- ekspedisi/beratKoli sudah wajib diisi vendor
 *  sebelum koli "Delivery", jadi TIDAK PERNAH butuh input manual tambahan). Denda/reward vendor
 *  SENGAJA TIDAK masuk (dikeluarkan dari HPP sesuai keputusan user, ikut Excel yang juga tidak
 *  punya kolom ini) -- beda dari hppRowsForInvoice lama yang masih memotongkannya.
 *
 *  Baris invoice yang GRUP warna+lengannya belum py roll ber-`closedAt` & terkirim (MRP lama,
 *  sebelum fitur "Tutup Roll" ada) di-fallback ke hppRowsForInvoice lama (pool, TERMASUK denda/
 *  reward seperti sebelumnya) supaya histori HPP MRP lama tidak hilang/kosong -- lihat plan.
 *
 *  BUG FIX (2026-09-09, live-verified — PO-01 ABU MUDA · PENDEK ditagih lewat 2 invoice terpisah,
 *  VINV-296524 qty 320 = pas 3 roll penuh & VINV-296528 qty 30 = sisa hasil rework yang TIDAK
 *  terikat roll manapun): dulu tiap baris invoice untuk 1 groupKey mengambil SEMUA roll
 *  closed+terkirim groupKey itu tanpa peduli roll itu SUDAH "diklaim" invoice LAIN yang groupKey-
 *  nya sama -- baris VINV-296528 ikut menampilkan 3 roll yang SAMA seperti VINV-296524 (duplikat
 *  total di Laporan HPP), dan qty 30 rework-nya sendiri tidak pernah dihitung sama sekali. Fix:
 *  parameter baru `allVendorInvoices` dipakai untuk hitung berapa banyak "pool roll" groupKey ini
 *  sudah diklaim invoice yang urutannya (submittedAt lalu id) lebih dulu -- baris invoice ini cuma
 *  dapat SISA pool yang belum diklaim (`rollPortion`), kelebihannya (`legacyPortion`, mis. qty
 *  hasil rework yang tidak terikat roll) fallback ke `hppRowsForInvoice` (pool lama) yang SUDAH
 *  BENAR untuk kasus ini (reject net & rework berlabel, dikenai tarif maklon normal).
 *
 *  Reject per (roll,size) SEKARANG JUGA di-netting FIFO pakai `reworkedAwayBySize(groupKey)` (fix
 *  yang sama, dikonfirmasi user) — baris roll yang rejectnya sebagian sudah dirework tampil BERSIH
 *  (mis. 10, bukan 40 mentah), dengan `rework` kolom baru menunjukkan berapa dari reject roll itu
 *  yang sudah dirework. Baris legacy/pool yang muncul BERBARENGAN dengan roll untuk groupKey yang
 *  sama (brace `groupKeyHasRolls`) di-nolkan reject-nya (supaya tidak dobel-tampil angka net yang
 *  sama di 2 baris berbeda — `s.reject` dari hppRowsForInvoice adalah angka GROUP yang identik
 *  dengan yang sudah dijumlah dari netting per-roll) — rework tetap tampil apa adanya di sana.
 *
 *  BUG FIX (2026-09-09, user-reported lewat live screenshot Laporan HPP): qty hasil rework
 *  ("legacyPortion" di atas) dulu jatuh ke `hppRowsForInvoice`, yang MENYEBAR fg-nya ke SEMUA size
 *  grup secara proporsional (`lineShare`, heuristik lama) -- padahal size ASLI qty rework itu SUDAH
 *  DIKETAHUI PERSIS (tercatat di size tujuan rework, `production_results`, DAN di item koli
 *  pengiriman yang membawanya). Live case: rework 30 pcs size M SEHARUSNYA cuma muncul di size M,
 *  bukan tersebar ke M/XL/S/2XL. Fix: baris size ASLI dari `production_results` (kind FG, note
 *  "Rework dari...") diikuti sampai ke KOLI PENGIRIMAN yang membawanya (item `kind==="REWORK"` di
 *  `deliveryKolis`, size & koli-nya sudah tercatat asli di sana) -- dibangun jadi "rework chunk"
 *  (paralel dengan "roll chunk" di atas, dialokasikan FIFO lintas-invoice dengan cara yang SAMA),
 *  jadi baris rework HPP sekarang: (a) size-nya PERSIS sama seperti yang dikirim, (b) tahu koli
 *  pengiriman asalnya (`noKoli`), (c) COGS bahan = 0 (kain rework itu REJECT dari roll lain yang
 *  biaya bahannya SUDAH sepenuhnya terserap ke baris FG roll asal itu -- dihitung lagi di sini
 *  akan dobel-hitung bahan yang sama), (d) ongkir dihitung dari koli SPESIFIK yang membawanya
 *  (`koliOngkirTotal / totalPcsInKoli`, formula SAMA seperti baris roll -- bukan lagi pool
 *  campur-semua-koli-mrpId yang jadi akar bug ongkir sebelumnya). `hppRowsForInvoice` (pool lama)
 *  sekarang HANYA jadi fallback untuk sisa qty yang genuinely tidak ketemu di roll pool ATAUPUN
 *  rework pool (data lama/anomali) -- seharusnya jarang/tidak pernah kejadian untuk groupKey yang
 *  sudah pakai roll tracking. */
export function hppRowsForInvoicePerRoll(
  inv: VendorInvoice,
  allVendorInvoices: VendorInvoice[],
  mrpDetails: MrpDetail[],
  staticMrps: Mrp[],
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  rawInvoices: RawMaterialInvoice[],
  deliveryKolis: DeliveryKoli[]
): HppRow[] {
  const rows: HppRow[] = [];
  const legacyLines: VendorInvoiceLine[] = [];
  const groupKeyHasRolls = new Map<string, boolean>();

  type RollChunk = { roll: ProductionBatch; size: string; fgQty: number; cuttingQty: number; rejectQty: number; reworkQty: number };
  type ReworkChunk = { koli: DeliveryKoli; size: string; usia?: Usia; qty: number };

  for (const line of inv.lines) {
    const groupKey = line.mrpId + "|" + line.warna + "|" + line.lengan;
    const shippedRolls = productionBatches.filter(
      (b) =>
        b.mrpId === line.mrpId &&
        b.vendorProduksi === inv.vendorProduksi &&
        b.warna === line.warna &&
        b.lengan === line.lengan &&
        b.closedAt &&
        b.fgSizeQty &&
        deliveryKolis.some((k) => (k.sourceBatchIds ?? []).includes(b.id))
    );

    // Chunk kanonik per (roll,size), reject sudah dinetting FIFO -- murni fungsi dari
    // productionBatches/productionResults, SELALU sama persis untuk groupKey yang sama apa pun
    // invoice yang sedang diproses (lihat catatan di atas).
    const chunks: RollChunk[] = [];
    const reworkPoolRemaining: Record<string, number> = { ...reworkedAwayBySize(groupKey, productionResults) };
    for (const roll of shippedRolls) {
      const fgSizeQty = roll.fgSizeQty ?? {};
      const targetSizes = roll.sizeQty ?? {};
      for (const [size, fgQtyRaw] of Object.entries(fgSizeQty)) {
        if (fgQtyRaw <= 0) continue;
        const cuttingQty = targetSizes[size] ?? fgQtyRaw;
        const rejectRaw = Math.max(0, cuttingQty - fgQtyRaw);
        const reworkQty = Math.min(rejectRaw, reworkPoolRemaining[size] ?? 0);
        reworkPoolRemaining[size] = (reworkPoolRemaining[size] ?? 0) - reworkQty;
        chunks.push({ roll, size, fgQty: fgQtyRaw, cuttingQty, rejectQty: rejectRaw - reworkQty, reworkQty });
      }
    }
    const totalRollFgForGroup = chunks.reduce((s, c) => s + c.fgQty, 0);
    groupKeyHasRolls.set(groupKey, totalRollFgForGroup > 0);

    // Chunk kanonik hasil REWORK yang sudah terkirim -- size & koli asalnya diambil LANGSUNG dari
    // item koli pengiriman (kind==="REWORK", sudah tercatat asli di sana), BUKAN disebar
    // proporsional lewat heuristik lama (lihat catatan bug fix di atas fungsi). Urutan array
    // deliveryKolis/k.items sudah deterministik (fix ORDER BY PR #39), jadi alokasi FIFO di bawah
    // konsisten tiap dipanggil ulang untuk groupKey yang sama.
    const reworkChunks: ReworkChunk[] = [];
    for (const k of deliveryKolis) {
      if (k.vendorProduksi !== inv.vendorProduksi || k.mrpId !== line.mrpId || !k.deliveredAt) continue;
      for (const it of k.items) {
        if (it.kind === "REWORK" && it.warna === line.warna && it.lengan === line.lengan && it.qty > 0) {
          reworkChunks.push({ koli: k, size: it.size, usia: it.usia, qty: it.qty });
        }
      }
    }
    const totalReworkForGroup = reworkChunks.reduce((s, c) => s + c.qty, 0);

    // Berapa banyak pool (roll DULU, baru rework -- diperlakukan sebagai SATU pool berkelanjutan)
    // groupKey ini SUDAH diklaim invoice lain yang urutannya lebih dulu.
    const totalPool = totalRollFgForGroup + totalReworkForGroup;
    const invoicesForGroup = allVendorInvoices
      .filter((o) => o.status !== "REVISION" && o.vendorProduksi === inv.vendorProduksi)
      .flatMap((o) => o.lines.filter((l) => l.mrpId === line.mrpId && l.warna === line.warna && l.lengan === line.lengan).map((l) => ({ invId: o.id, submittedAt: o.submittedAt, qty: l.qty })));
    const priorQty = invoicesForGroup
      .filter((e) => e.submittedAt < inv.submittedAt || (e.submittedAt === inv.submittedAt && e.invId < inv.id))
      .reduce((s, e) => s + e.qty, 0);
    const before = Math.min(priorQty, totalPool);
    const after = Math.min(priorQty + line.qty, totalPool);
    const combinedPortion = Math.max(0, after - before);
    const trueLegacyPortion = line.qty - combinedPortion;

    if (trueLegacyPortion > 0) legacyLines.push({ ...line, qty: trueLegacyPortion });
    if (combinedPortion <= 0) continue;

    // Dalam window [before,after) gabungan, pisahkan lagi jadi porsi roll (ruang
    // [0,totalRollFgForGroup)) dan porsi rework (ruang [totalRollFgForGroup,totalPool), digeser
    // -totalRollFgForGroup supaya reworkChunks bisa di-slice dengan basis 0 yang sama seperti chunks).
    const rollBefore = Math.min(before, totalRollFgForGroup);
    const rollAfter = Math.min(after, totalRollFgForGroup);
    const reworkBefore = Math.max(0, before - totalRollFgForGroup);
    const reworkAfter = Math.max(0, after - totalRollFgForGroup);

    const mrp = mrpMetaFor(line.mrpId, mrpDetails, staticMrps);
    const meta = productionGroupMetaFor(groupKey, productionGroupMeta);
    const target = targetDoneProduksiForGroup(line.mrpId, inv.vendorProduksi, line.warna, rawInvoices);
    const status = productionStatusFromDates(target, meta?.doneAt);
    const statusLabel = status ? (status.label === "DELAY" ? "Delay" : status.label === "ONTIME" ? "Ontime" : "Lebih Cepat") : "—";
    const jumlahRoll = productionBatches.filter((b) => b.mrpId === line.mrpId && b.warna === line.warna && b.lengan === line.lengan).reduce((s, b) => s + b.qtyRoll, 0);

    // Ambil chunk roll pada rentang qty [rollBefore, rollAfter) -- kalau batas jatuh di tengah 1
    // chunk, chunk itu dipecah proporsional (qty & turunannya diskalakan takeQty/fgQty, rate PER
    // PC tidak berubah).
    let pos = 0;
    for (const c of chunks) {
      const chunkStart = pos;
      pos += c.fgQty;
      const takeStart = Math.max(rollBefore, chunkStart);
      const takeEnd = Math.min(rollAfter, pos);
      if (takeEnd <= takeStart) continue;
      const takeQty = takeEnd - takeStart;
      const portion = takeQty / c.fgQty;

      const roll = c.roll;
      const rawRoll = findRawMaterialRollForBatch(roll, rawInvoices);
      const pool = rawRoll ? null : materialCostForWarna(line.warna, inv.vendorProduksi, rawInvoices);
      // BUG FIX 2026-09-07: `hargaPerKg` (dari codeRoll yang match) itu harga PER KG, bukan harga
      // TOTAL roll -- dulu dipakai langsung seolah sudah jadi biaya total 1 roll (persis bug yang
      // sama seperti materialCostForWarna). Biaya total roll ini SPESIFIK = hargaPerKg x berat
      // GROSS roll ini (gross, bukan net -- konsisten dengan nilai yang ditagih supplier, lihat
      // catatan di materialCostForWarna). Fallback pool (`pool.hargaBahanTotal / pool.rollCount`)
      // sudah otomatis benar sekarang setelah materialCostForWarna dibetulkan -- itu rata-rata
      // biaya TOTAL per roll, bukan per kg, jadi tidak perlu dikali apa pun lagi di sini.
      const rollTotalCost = rawRoll ? rawRoll.hargaPerKg * rawRoll.grossKg : pool && pool.rollCount > 0 ? pool.hargaBahanTotal / pool.rollCount : 0;
      const netKg = rawRoll ? rawRoll.netKg : pool && pool.rollCount > 0 ? pool.totalNetWeight / pool.rollCount : 0;
      const totalFgRoll = Object.values(roll.fgSizeQty ?? {}).reduce((a, b) => a + b, 0);
      const materialCostPerPcRoll = totalFgRoll > 0 ? rollTotalCost / totalFgRoll : 0;

      const koli = deliveryKolis.find((k) => (k.sourceBatchIds ?? []).includes(roll.id));
      const totalPcsInKoli = koli ? koli.items.reduce((s, it) => s + it.qty, 0) : 0;
      // Revisi 2026-09-07: ongkir batch koli ini SENGAJA tidak wajib diinput manual -- `ongkirBatch`
      // (field "Ongkir batch ini" di Pengiriman) cuma dipakai kalau memang diisi (override, mis.
      // ada nilai RIIL dari invoice ekspedisi yang beda dari tarif standar). Kalau kosong, fallback
      // ke tarif ekspedisi x berat koli (ekspedisiPrice, formula sama seperti sebelum fitur roll
      // ini ada) -- ekspedisi & berat koli SUDAH WAJIB diisi vendor sebelum koli bisa "Delivery"
      // (lihat doDelivery di app/vendor-maklon/pengiriman/page.tsx), jadi selalu ada nilainya tanpa
      // perlu input tambahan.
      const koliOngkirTotal = koli ? koli.ongkirBatch ?? ekspedisiPrice(koli.ekspedisi, koli.beratKoli ?? 0) : 0;
      const ongkirPerPc = totalPcsInKoli > 0 ? koliOngkirTotal / totalPcsInKoli : 0;

      // Denda/reward TIDAK masuk HPP di jalur baru ini (keputusan user, ikut Excel) -- biaya
      // produksi per pc murni tarif maklon, tanpa pemotonganDenda seperti hppRowsForInvoice lama.
      const biayaProduksiPerItem = line.ratePerPc;
      const hppPerItem = materialCostPerPcRoll + biayaProduksiPerItem + ongkirPerPc;

      const fgQty = takeQty;
      const cuttingQty = c.cuttingQty * portion;
      const rejectQty = c.rejectQty * portion;
      const reworkQty = c.reworkQty * portion;
      rows.push({
        invoiceId: inv.id,
        vendorProduksi: inv.vendorProduksi,
        noKoli: koli?.noKoli,
        mrpId: line.mrpId,
        mrpLabel: `${line.mrpId} ${mrp?.kategori ?? ""}`.trim(),
        warna: line.warna,
        lengan: line.lengan,
        item: `${line.warna} ${HPP_LENGAN_ABBR[line.lengan]} ${c.size} · roll ${roll.codeRoll ?? roll.id}`,
        jenis: `${line.lengan} ${c.size}`,
        qtyPo: cuttingQty,
        cutting: cuttingQty,
        fg: fgQty,
        reject: rejectQty,
        rework: reworkQty,
        statusLabel,
        yieldPct: cuttingQty > 0 ? (fgQty / cuttingQty) * 100 : 0,
        maklonRate: line.ratePerPc,
        jumlahRoll,
        totalBeratBahan: netKg,
        faktorProduksi: cuttingQty > 0 ? fgQty / cuttingQty : 0,
        aktualBeratTerpakai: totalFgRoll > 0 ? netKg * (fgQty / totalFgRoll) : 0,
        persentase: totalFgRoll > 0 ? fgQty / totalFgRoll : 0,
        hargaBahanTotal: rollTotalCost,
        cogsBahan: materialCostPerPcRoll * fgQty,
        cogsBahanPerItem: materialCostPerPcRoll,
        pemotonganDenda: 0,
        biayaProduksiTotal: biayaProduksiPerItem * fgQty,
        biayaProduksiPerItem,
        ongkirPerItem: ongkirPerPc,
        totalOngkirRow: ongkirPerPc * fgQty,
        hppPerItem,
      });
    }

    // Ambil chunk rework pada rentang qty [reworkBefore, reworkAfter) -- size & koli asal PERSIS
    // dari item koli pengiriman (bukan disebar proporsional seperti dulu). COGS bahan = 0 (lihat
    // catatan panjang di atas fungsi -- kainnya REJECT yang biayanya sudah terserap penuh ke baris
    // FG roll asalnya, dihitung lagi di sini akan dobel-hitung bahan yang sama). Ongkir dihitung
    // dari koli SPESIFIK yang membawanya, formula SAMA seperti baris roll di atas.
    let rpos = 0;
    for (const c of reworkChunks) {
      const chunkStart = rpos;
      rpos += c.qty;
      const takeStart = Math.max(reworkBefore, chunkStart);
      const takeEnd = Math.min(reworkAfter, rpos);
      if (takeEnd <= takeStart) continue;
      const takeQty = takeEnd - takeStart;

      const totalPcsInKoli = c.koli.items.reduce((s, it) => s + it.qty, 0);
      const koliOngkirTotal = c.koli.ongkirBatch ?? ekspedisiPrice(c.koli.ekspedisi, c.koli.beratKoli ?? 0);
      const ongkirPerPc = totalPcsInKoli > 0 ? koliOngkirTotal / totalPcsInKoli : 0;

      const biayaProduksiPerItem = line.ratePerPc;
      const hppPerItem = biayaProduksiPerItem + ongkirPerPc;
      const usiaLabel = c.usia === "KIDS" ? "Kids" : c.usia === "DEWASA" ? "Dewasa" : "";

      rows.push({
        invoiceId: inv.id,
        vendorProduksi: inv.vendorProduksi,
        noKoli: c.koli.noKoli,
        mrpId: line.mrpId,
        mrpLabel: `${line.mrpId} ${mrp?.kategori ?? ""}`.trim(),
        warna: line.warna,
        lengan: line.lengan,
        item: `${line.warna} ${HPP_LENGAN_ABBR[line.lengan]} ${c.size} · Rework${usiaLabel ? " (" + usiaLabel + ")" : ""} · koli ${c.koli.noKoli}`,
        jenis: `${line.lengan} ${c.size}`,
        qtyPo: takeQty,
        cutting: takeQty,
        fg: takeQty,
        reject: 0,
        rework: takeQty,
        statusLabel,
        yieldPct: 100,
        maklonRate: line.ratePerPc,
        jumlahRoll,
        totalBeratBahan: 0,
        faktorProduksi: 1,
        aktualBeratTerpakai: 0,
        persentase: 0,
        hargaBahanTotal: 0,
        cogsBahan: 0,
        cogsBahanPerItem: 0,
        pemotonganDenda: 0,
        biayaProduksiTotal: biayaProduksiPerItem * takeQty,
        biayaProduksiPerItem,
        ongkirPerItem: ongkirPerPc,
        totalOngkirRow: ongkirPerPc * takeQty,
        hppPerItem,
      });
    }
  }

  // Baris yang grup warna+lengannya belum punya roll ber-closedAt & terkirim sama sekali (MRP
  // lama), ATAU porsi qty yang melebihi pool roll groupKey ini (mis. hasil rework yang tidak
  // terikat roll manapun) -- fallback ke jalur pool lama APA ADANYA (termasuk denda/reward) untuk
  // biaya produksi/COGS bahan (TIDAK terpengaruh bug ongkir di bawah, aman dipakai apa adanya).
  if (legacyLines.length > 0) {
    const legacyInv: VendorInvoice = { ...inv, lines: legacyLines };
    const ongkirTotal = autoOngkirForInvoice(legacyInv, deliveryKolis);
    const legacyRows = hppRowsForInvoice(legacyInv, ongkirTotal, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis);

    // BUG FIX (2026-09-09, user-reported): `autoOngkirForInvoice` (dipakai `ongkirTotal` di atas)
    // menjumlahkan ongkir SEMUA koli milik mrpId ini apa adanya -- benar untuk invoice yang 100%
    // legacy (tidak ada roll sama sekali), tapi SALAH begitu groupKey-nya JUGA punya baris roll
    // (kasus baru sejak fix duplikasi HPP di atas): koli yang ongkirnya SUDAH lunas "dipakai" penuh
    // oleh baris roll (lihat perhitungan roll di atas -- `koliOngkirTotal / totalPcsInKoli` per pc)
    // ikut kepool lagi di sini, jadi porsi ongkirnya "dibagi ulang" ke baris legacy padahal sudah
    // kepakai di baris roll -- totalnya jadi TIDAK SAMA dengan jumlah ongkir riil semua koli (live-
    // verified: Rp 474.000 di Riwayat Pengiriman vendor vs Rp 416.600 di Laporan HPP).
    //
    // Fix: hitung ulang ongkir baris legacy per koli, PRORATA berdasar porsi pcs koli itu yang
    // BUKAN dari roll (`nonRollPcs`) -- bukan exclude-semua-atau-tidak-sama-sekali, supaya kalau
    // suatu saat 1 koli berisi CAMPURAN item dari roll & item legacy/rework (mungkin lewat "Isi
    // koli (Rework & sisa FG lama)" di halaman Pengiriman) porsi ongkirnya tetap kebagi benar ke
    // kedua sisi, bukan hilang atau dobel. Dihitung LANGSUNG dari productionBatches+deliveryKolis
    // (bukan dari baris roll yang sudah di-emit di atas) supaya TIDAK bergantung invoice mana yang
    // sedang diproses saat ini -- 1 roll bisa jadi baru diklaim rollPortion-nya oleh invoice LAIN
    // (lihat alokasi FIFO di atas), jadi baris roll UNTUK roll itu belum tentu ikut ke-emit di
    // pemanggilan fungsi ini secara khusus, padahal koli-nya tetap harus dianggap "sudah kepakai".
    // Untuk invoice yang groupKey-nya 100% legacy (tidak ada roll sama sekali), tiap koli terkait
    // otomatis nonRollPcs = totalPcsInKoli (rollCoveredPcs = 0) -- identik dengan ongkirTotal/
    // totalPcsInKoli yang sudah dihitung hppRowsForInvoice di atas (no-op, aman).
    const legacyMrpIds = new Set(legacyLines.map((l) => l.mrpId));
    const relevantKolis = deliveryKolis.filter((k) => k.vendorProduksi === inv.vendorProduksi && legacyMrpIds.has(k.mrpId));
    let correctOngkirTotal = 0;
    let correctTotalPcs = 0;
    for (const k of relevantKolis) {
      const totalPcsInKoli = k.items.reduce((s, it) => s + it.qty, 0);
      if (totalPcsInKoli <= 0) continue;
      const koliOngkirTotal = k.ongkirBatch ?? ekspedisiPrice(k.ekspedisi, k.beratKoli ?? 0);
      const rollCoveredPcs = Math.min(
        totalPcsInKoli,
        (k.sourceBatchIds ?? []).reduce((s, rollId) => {
          const roll = productionBatches.find((b) => b.id === rollId);
          return s + (roll ? Object.values(roll.fgSizeQty ?? {}).reduce((a, b) => a + b, 0) : 0);
        }, 0)
      );
      const nonRollPcs = totalPcsInKoli - rollCoveredPcs;
      correctOngkirTotal += koliOngkirTotal * (nonRollPcs / totalPcsInKoli);
      correctTotalPcs += nonRollPcs;
    }
    const correctOngkirPerPc = correctTotalPcs > 0 ? correctOngkirTotal / correctTotalPcs : 0;

    for (const r of legacyRows) {
      // Kalau groupKey ini SUDAH punya roll (baris roll di atas sudah menampilkan reject bersih
      // untuk grup ini), reject di baris legacy dinolkan supaya tidak dobel-tampil angka net yang
      // sama di 2 baris berbeda -- lihat catatan di atas.
      if (groupKeyHasRolls.get(r.mrpId + "|" + r.warna + "|" + r.lengan)) r.reject = 0;
      r.hppPerItem = r.hppPerItem - r.ongkirPerItem + correctOngkirPerPc;
      r.ongkirPerItem = correctOngkirPerPc;
      r.totalOngkirRow = correctOngkirPerPc * r.fg;
    }
    rows.push(...legacyRows);
  }

  return rows;
}
