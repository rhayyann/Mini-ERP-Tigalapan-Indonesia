import { EKSPEDISI_RATES, MATERIAL_RATE_PER_ROLL, VENDOR_PRODUKSI } from "./seed";
import type { MrpDetail, PpicApprovalStatus } from "./store";
import type { HargaKainPksRow, HargaKainRow, HargaMaklonRow, SupplierRow } from "./masterData";
import type { AduanPolaRow, ColorBreakdown, DeliveryKoli, Lengan, LenganGroup, MaklonInvoice, MaklonPO, MaterialPO, MaterialRow, Mrp, ProductionBatch, ProductionGroupMeta, ProductionResult, ProductionResultKind, ProductionYieldResolution, RawMaterialInvoice, ShippableKind, Usia, VendorInvoice } from "./types";

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
  for (const c of colorBreakdown) kgByWarna.set(c.warna, (kgByWarna.get(c.warna) ?? 0) + c.rollCount * 25);
  const rateByWarna = new Map<string, number>();
  for (const [warna, kg] of kgByWarna) rateByWarna.set(warna, hargaKainRate(hargaKain, hargaKainPks, supplierName, warna, kg));
  let total = 0;
  for (const c of colorBreakdown) total += c.rollCount * 25 * (rateByWarna.get(c.warna) ?? 0);
  return Math.round(total);
}

export type VendorProduksiRow = {
  vendor: string;
  name: string;
  qty: number;
  capacityPct: number;
  fee: number;
  estDays: number;
};

export function vendorProduksiRows(detail: MrpDetail, hargaMaklon: HargaMaklonRow[]): VendorProduksiRow[] {
  const rowsByVendor = new Map<string, AduanPolaRow[]>();
  for (const a of detail.aduanRows) {
    const arr = rowsByVendor.get(a.vendor) ?? [];
    arr.push(a);
    rowsByVendor.set(a.vendor, arr);
  }
  return Array.from(rowsByVendor.entries()).map(([vendor, rows]) => {
    const meta = VENDOR_PRODUKSI[vendor] ?? { name: vendor, baseCapacity: 5000, ratePerPc: 7000, estDays: 12 };
    const qty = rows.reduce((s, r) => s + r.qty, 0);
    return {
      vendor,
      name: meta.name,
      qty,
      capacityPct: Math.min(100, Math.round((qty / meta.baseCapacity) * 100)),
      // Fase 2: sama seperti sendPoToFinance — lookup bertingkat Master Data > Harga Maklon,
      // bukan flat ratePerPc lagi, supaya preview "Est. Biaya" ini sama persis dengan PO yang
      // benar-benar dibuat nanti (lihat maklonAmountForVendor).
      fee: maklonAmountForVendor(hargaMaklon, vendor, rows),
      estDays: meta.estDays,
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

export function weightVariance(grossKg: number, netKg: number) {
  const diff = netKg - grossKg;
  const pct = grossKg > 0 ? (diff / grossKg) * 100 : 0;
  const withinTolerance = Math.abs(pct) <= WEIGHT_TOLERANCE_PCT;
  return { diff, pct, withinTolerance };
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

/** Daftar klaim selisih berat DI LUAR TOLERANSI — diturunkan langsung dari `invoices` (gross per
 *  roll ada di `colorEntries[].rolls[idx]`, net ada di `rollReceipts`), bukan dari field
 *  tersendiri — setiap roll yang berhasil disimpan dengan selisih di luar toleransi PASTI sudah
 *  lewat dialog "Kirim Claim" di Good Receive vendor (lihat app/vendor-maklon/receiving/page.tsx),
 *  jadi tidak butuh flag terpisah untuk tahu roll mana yang "diklaim". Dipakai halaman Procurement
 *  > Klaim Material. */
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
        if (variance.withinTolerance) return;
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
        });
      });
    }
  }
  return out.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
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
      // Roll dengan klaim selisih berat AKTIF (di luar toleransi & belum ditimbang ulang sampai
      // sesuai — lihat requestMaterialClaimRetur) sengaja TIDAK dihitung tersedia untuk dipotong,
      // supaya material bermasalah tidak terpakai produksi sebelum retur ke supplier selesai.
      const grossKg = colorEntry?.rolls[idx];
      if (grossKg !== undefined && !weightVariance(grossKg, r.netKg).withinTolerance) return;
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
  /** Roll ini sudah pernah ditimbang tapi selisihnya di luar toleransi & belum ditimbang ulang
   *  sesuai — perlu ditimbang ULANG (lihat materialClaimsList), bukan ditimbang pertama kali. */
  netKg?: number;
};

/** Roll yang sudah ditandai diterima (Good Receive) untuk MRP+vendor ini tapi belum ditimbang —
 *  atau sudah ditimbang tapi masih ada klaim selisih berat aktif (di luar toleransi, perlu
 *  ditimbang ulang) — dipakai di halaman Cutting sebagai daftar "Timbang roll" sebelum roll itu
 *  bisa dipilih untuk Resting (lihat availableCodeRollsForColor). */
/** Roll yang sudah ditimbang & dalam toleransi TETAP ikut ditampilkan di sini selama roll itu
 *  belum benar-benar dipakai di suatu ProductionBatch (dipilih code roll-nya lalu di-submit
 *  Resting) — supaya salah timbang masih bisa dikoreksi sebelum benar-benar masuk tahap cutting
 *  (dulu roll langsung "hilang" dari sini begitu disimpan, padahal cuma jadi tersedia dipilih,
 *  belum jadi batch — tidak ada cara balik lihat/edit kalau salah timbang). Begitu code roll-nya
 *  sudah terpakai di suatu batch, roll ini baru hilang dari daftar (edit sesudahnya akan bikin
 *  data batch yang sudah tersimpan tidak konsisten). */
export function pendingWeighRolls(mrpId: string, vendorId: string, invoices: RawMaterialInvoice[], batches: ProductionBatch[]): PendingWeighRoll[] {
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
        const arrival = arrivals[idx];
        if (!arrival) return;
        const receipt = receipts[idx];
        const claimKey = `${inv.id}|${key}|${idx}`;
        if (receipt && !activeClaimKeys.has(claimKey) && receipt.codeRoll && usedCodeRolls.has(receipt.codeRoll)) return;
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

/** Total roll yang muncul di section "Timbang roll" Cutting (belum ditimbang, ATAU sudah
 *  ditimbang tapi belum terpakai di batch manapun — lihat catatan di pendingWeighRolls),
 *  dihitung lintas SEMUA MRP untuk vendor ini — dipakai badge sidebar "Produksi" dan tab
 *  "Cutting" (lib/shell/badges.ts) supaya roll yang nyangkut di sana ikut kelihatan. Sebelumnya
 *  badge cuma menghitung ProductionBatch, padahal roll yang belum ditimbang belum jadi
 *  ProductionBatch sama sekali (baru jadi batch setelah ditimbang + dipilih ke Resting) — jadi
 *  roll yang menunggu ditimbang tidak pernah kelihatan di badge mana pun. Logic sama seperti
 *  pendingWeighRolls di atas, cuma tidak dibatasi ke satu mrpId. */
export function pendingWeighRollsCount(vendorId: string, invoices: RawMaterialInvoice[], batches: ProductionBatch[]): number {
  const activeClaimKeys = new Set(materialClaimsList(invoices).map((c) => c.key));
  let count = 0;
  for (const inv of invoices) {
    if (inv.destinationVendor !== vendorId) continue;
    for (const c of inv.colorEntries) {
      const key = c.warna + "|" + c.lengan;
      const arrivals = inv.rollArrivals[key] ?? [];
      const receipts = inv.rollReceipts[key] ?? [];
      const usedCodeRolls = new Set(
        batches.filter((b) => b.mrpId === inv.mrpId && b.vendorProduksi === vendorId && b.warna === c.warna && b.lengan === c.lengan && b.codeRoll).map((b) => b.codeRoll!)
      );
      c.rolls.forEach((_grossKg, idx) => {
        const arrival = arrivals[idx];
        if (!arrival) return;
        const receipt = receipts[idx];
        const claimKey = `${inv.id}|${key}|${idx}`;
        if (receipt && !activeClaimKeys.has(claimKey) && receipt.codeRoll && usedCodeRolls.has(receipt.codeRoll)) return;
        count++;
      });
    }
  }
  return count;
}

export function startedRollsForAduan(aduanRowId: string, batches: ProductionBatch[]): number {
  return batches.filter((b) => b.aduanRowId === aduanRowId).reduce((s, b) => s + b.qtyRoll, 0);
}

export function availableRollsForAduanRow(row: AduanPolaRow, aduanRows: AduanPolaRow[], invoices: RawMaterialInvoice[], batches: ProductionBatch[], mrpId: string): number {
  const received = receivedRollCountWithCodeForColor(mrpId, row.vendor, row.warna, row.lengan, invoices);
  const sameColorRows = aduanRows.filter((a) => a.vendor === row.vendor && a.warna === row.warna && a.lengan === row.lengan);
  const startedForColor = sameColorRows.reduce((s, r) => s + startedRollsForAduan(r.id, batches), 0);
  const availableForColor = Math.max(0, received - startedForColor);
  const remainingForRow = Math.max(0, row.qtyRoll - startedRollsForAduan(row.id, batches));
  return Math.min(remainingForRow, availableForColor);
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
      // Sama seperti receivedRollCountWithCodeForColor — roll dengan klaim aktif tidak boleh
      // muncul sebagai code roll yang bisa dipilih untuk Resting/Cutting.
      const grossKg = colorEntry?.rolls[idx];
      if (grossKg !== undefined && !weightVariance(grossKg, r.netKg).withinTolerance) return;
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

/** "Total Qty" hasil cutting per grup warna/lengan — SUMBER UTAMA sekarang hasil aduan AKTUAL
 *  yang diinput vendor per roll (actualCutSizesForGroup), fallback ke estimasi rasio lama
 *  (targetSizesForGroup) hanya kalau belum ada satu pun batch grup ini yang diisi hasil aduannya.
 *  Dipakai sebagai denominator progres Finish Good & basis target Reject (bukan lagi murni
 *  estimasi dari rencana MRP, sesuai permintaan user). */
export function cuttingSizesForGroup(mrpId: string, warna: string, lengan: Lengan, mrpDetails: MrpDetail[], batches: ProductionBatch[]): Record<string, number> {
  const actual = actualCutSizesForGroup(mrpId, warna, lengan, batches);
  if (Object.keys(actual).length > 0) return actual;
  return targetSizesForGroup(mrpId, warna, lengan, mrpDetails, batches);
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
 *  belum lengkap), dianggap belum selesai. */
export function maklonProductionFullyDone(
  mrpId: string,
  vendorProduksi: string,
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  results: ProductionResult[]
): boolean {
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

export function mrpIdsWithRemainingReject(vendorProduksi: string, batches: ProductionBatch[], results: ProductionResult[]): string[] {
  const mrpIds = Array.from(new Set(batches.filter((b) => b.vendorProduksi === vendorProduksi && b.cuttingAt).map((b) => b.mrpId)));
  return mrpIds.filter((mrpId) => {
    const groups = cutWarnaLenganGroups(mrpId, vendorProduksi, batches);
    return groups.some((g) => {
      const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
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

export type AvailableFgRow = { warna: string; lengan: Lengan; size: string; usia?: Usia; available: number };

function isReworkResult(r: ProductionResult): boolean {
  return !!r.note && r.note.startsWith("Rework dari");
}

function resultMatchesShippableKind(r: ProductionResult, source: ShippableKind): boolean {
  if (source === "REJECT") return r.kind === "REJECT";
  if (source === "REWORK") return r.kind === "FG" && isReworkResult(r);
  return r.kind === "FG" && !isReworkResult(r);
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

export function availableFgToShip(mrpId: string, vendorProduksi: string, results: ProductionResult[], kolis: DeliveryKoli[], excludeKoliId?: string, source: ShippableKind = "FG"): AvailableFgRow[] {
  const produced = fgProducedBySize(mrpId, vendorProduksi, results, source);
  const packed = fgPackedBySize(mrpId, vendorProduksi, kolis, excludeKoliId, source);
  const out: AvailableFgRow[] = [];
  for (const [key, producedQty] of produced.entries()) {
    const available = producedQty - (packed.get(key) ?? 0);
    if (available > 0) {
      const [warna, lengan, size, usia] = key.split("|");
      out.push({ warna, lengan: lengan as Lengan, size, usia: (usia || undefined) as Usia | undefined, available });
    }
  }
  return out;
}

export function mrpIdsWithUnpackedFg(vendorProduksi: string, results: ProductionResult[], kolis: DeliveryKoli[]): string[] {
  const sources: ShippableKind[] = ["FG", "REJECT", "REWORK"];
  const mrpIds = Array.from(new Set(results.filter((r) => r.vendorProduksi === vendorProduksi).map((r) => r.mrpId)));
  return mrpIds.filter((mrpId) => sources.some((source) => availableFgToShip(mrpId, vendorProduksi, results, kolis, undefined, source).length > 0));
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

export function reworkQtyForGroup(groupKey: string, results: ProductionResult[]): number {
  return results
    .filter((r) => r.groupKey === groupKey && r.kind === "FG" && isReworkResult(r))
    .reduce((sum, r) => sum + Object.values(r.sizeQty).reduce((a, b) => a + b, 0), 0);
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

/** Per-size: berapa reject yang sudah dibuang ke sisa/waste (bukan dirework) — mirror
 *  reworkedAwayBySize tapi untuk deduksi dari wasteRejectSizeAction (note diawali "Waste"). */
export function wastedAwayBySize(groupKey: string, results: ProductionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.kind !== "REJECT" || r.groupKey !== groupKey || !r.note?.startsWith("Waste")) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) {
      if (qty < 0) out[size] = (out[size] ?? 0) + -qty;
    }
  }
  return out;
}

export function productionYieldByWarna(mrpId: string, vendorProduksi: string, mrpDetails: MrpDetail[], batches: ProductionBatch[], results: ProductionResult[]): ProductionYieldRow[] {
  const groups = cutWarnaLenganGroups(mrpId, vendorProduksi, batches);
  return groups.map((g) => {
    const target = targetSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, batches);
    const cutting = Object.values(target).reduce((a, b) => a + b, 0);
    const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
    const fg = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", results)).reduce((a, b) => a + b, 0);
    const reject = Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", results)).reduce((a, b) => a + b, 0);
    const rework = reworkQtyForGroup(groupKey, results);
    return { warna: g.warna, lengan: g.lengan, target: cutting, cutting, finishGood: fg, reject, rework, yieldPct: cutting > 0 ? (fg / cutting) * 100 : 0 };
  });
}

function reworkBySizeForGroup(groupKey: string, results: ProductionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    if (r.groupKey !== groupKey || r.kind !== "FG" || !isReworkResult(r)) continue;
    for (const [size, qty] of Object.entries(r.sizeQty)) out[size] = (out[size] ?? 0) + qty;
  }
  return out;
}

export function productionYieldBySize(mrpId: string, warna: string, lengan: Lengan, mrpDetails: MrpDetail[], batches: ProductionBatch[], results: ProductionResult[]): ProductionYieldRow[] {
  const target = targetSizesForGroup(mrpId, warna, lengan, mrpDetails, batches);
  const groupKey = mrpId + "|" + warna + "|" + lengan;
  const fg = cumulativeSizeQtyForGroup(groupKey, "FG", results);
  const reject = cumulativeSizeQtyForGroup(groupKey, "REJECT", results);
  const rework = reworkBySizeForGroup(groupKey, results);
  const sizes = Array.from(new Set([...Object.keys(target), ...Object.keys(fg), ...Object.keys(reject), ...Object.keys(rework)]));
  return sizes.map((size) => {
    const t = target[size] ?? 0;
    const f = fg[size] ?? 0;
    const r = reject[size] ?? 0;
    const rw = rework[size] ?? 0;
    return { warna, lengan, size, target: t, cutting: t, finishGood: f, reject: r, rework: rw, yieldPct: t > 0 ? (f / t) * 100 : 0 };
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
      hargaBahanTotal += c.hargaPerRoll * c.rolls.length;
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

export type HppRow = {
  invoiceId: string;
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
