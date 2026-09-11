/** Daftar vendor produksi eksternal (maklon) — sumbernya daftar riil dari tim Procurement
 *  (spreadsheet "VENDOR / KODE VENDOR / PASSWORD"), di-hardcode di sini (bukan live-import
 *  seperti Harga Maklon/Harga Kain) karena isinya kredensial login, bukan cuma data harga —
 *  key record = KODE VENDOR dari spreadsheet, dipakai sebagai vendorId di seluruh app.
 *  BAYU & GI-01 SENGAJA mempertahankan key lama (bukan "BY" sesuai kode di spreadsheet) supaya
 *  data yang sudah tersimpan (PO, invoice, dsb — semua disimpan pakai vendorId string ini) tetap
 *  cocok; cuma `name`-nya yang diperbarui mengikuti nama asli di spreadsheet.
 *  baseCapacity/ratePerPc/estDays/productionLeadDays untuk 8 vendor BARU (semua kecuali BAYU &
 *  GI-01) masih ANGKA PLACEHOLDER (belum ada datanya dari Procurement) — dipakai sebagai fallback
 *  terakhir kalau Master Data > Harga Maklon belum punya baris untuk vendor itu (lihat
 *  maklonAmountForVendor di lib/mrp/derive.ts). Update begitu rate & kapasitas riilnya tersedia.
 *
 *  CATATAN MIGRASI SUPABASE: field `password` yang dulu ada di sini (plaintext, ikut ter-bundle
 *  ke client) sudah DIHAPUS. Password login vendor sekarang cuma hidup sebagai hash bcrypt di
 *  kolom vendors_produksi.password_hash (lihat supabase/migrations/0002_seed_master_data.sql),
 *  dicek server-only lewat lib/auth/actions.ts#loginVendorAction — tidak pernah lagi bisa dibaca
 *  dari bundle JS.
 *
 *  `name` SEMUA KAPITAL (2026-09-11, user-reported: tampilan sempat menunjukkan KODE vendor
 *  mentah, mis. "GI-01", bukan nama lengkapnya "Yogi 01" -- di beberapa tempat memang bug
 *  (dropdown filter yang belum lewat lookup nama, lihat fix di material-claims/page.tsx &
 *  po-approval/page.tsx), tapi sekaligus jadi momentum menyeragamkan gaya tampilan nama vendor
 *  jadi UPPERCASE di semua tempat -- HAMPIR SEMUA render vendor di app ini sudah lewat pola
 *  `VENDOR_PRODUKSI[id]?.name ?? id`, jadi cukup uppercase-kan `name` di sini, tidak perlu ubah
 *  puluhan call site satu-satu). Padanan di DB (`vendors_produksi.name`, sumber prioritas untuk
 *  `vendorProduksiRows` di derive.ts) ikut di-uppercase di migration 0029 — JANGAN biarkan 2
 *  sumber ini beda kapitalisasi lagi. `normalizeVendorCode` (parseImport.ts) sudah
 *  case-insensitive (`.toUpperCase()` saat cocokkan), jadi import MRP tidak terpengaruh. */
export const VENDOR_PRODUKSI: Record<
  string,
  { name: string; baseCapacity: number; ratePerPc: number; estDays: number; retentionPct: number; productionLeadDays: number }
> = {
  BAYU: { name: "BAYU", baseCapacity: 8500, ratePerPc: 7000, estDays: 14, retentionPct: 10, productionLeadDays: 7 },
  "GI-01": { name: "YOGI 01", baseCapacity: 6200, ratePerPc: 6900, estDays: 11, retentionPct: 10, productionLeadDays: 7 },
  "GI-02": { name: "YOGI 02", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  CE: { name: "CECEP", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  KK: { name: "KOKO", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  CP: { name: "CUSTOM PROJECT", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  MKS: { name: "KONVEKSI MAKASSAR", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  AWL: { name: "AWAL", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  ART: { name: "ARTHA", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
  ELMN: { name: "ELANG", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7 },
};

export const SUPPLIERS = ["Supplier Rajut Jaya", "Supplier ABC", "Supplier Cemerlang"];

// Fallback flat lama untuk estimasi PO Material — dipindah ke sini (dari lib/mrp/store.ts) supaya
// lib/mrp/derive.ts bisa memakainya sebagai fallback terakhir di hargaKainRate() tanpa bikin
// circular import (derive.ts sudah diimpor store.ts). Dipakai kalau supplier+warna suatu PO sama
// sekali tidak ada di Master Data > Harga Kain (lihat lib/mrp/masterData.ts).
export const MATERIAL_RATE_PER_ROLL = 460000;

// Item 8a (feedback batch 2026-09-04): estimasi kg per roll dipakai di 2 tempat berbeda
// (materialAmountForPo di derive.ts, exportMaterialPoPdf di exportPoPdf.ts) — dulu hard-coded
// `25` terpisah di masing-masing (rawan drift kalau salah satu diubah tanpa yang lain, dan angka
// ini LANGSUNG memengaruhi uang/PO). Satu konstanta di sini, NILAINYA SENGAJA TIDAK DIUBAH.
export const ROLL_KG_ESTIMATE = 25;

export const ENTITAS_LIST = ["Tigalapan Indonesia", "PT Tigalapan Dua", "PT Tigalapan Tiga"];

export const RESTING_TARGET_MINUTES = 180;

export type EkspedisiRate = { ekspedisi: string; minKg: number; maxKg: number; pricePerKg: number };

export const EKSPEDISI_RATES: EkspedisiRate[] = [
  { ekspedisi: "JNE", minKg: 0, maxKg: 10, pricePerKg: 12000 },
  { ekspedisi: "JNE", minKg: 10, maxKg: 50, pricePerKg: 9000 },
  { ekspedisi: "JNE", minKg: 50, maxKg: Infinity, pricePerKg: 7000 },
  { ekspedisi: "J&T Express", minKg: 0, maxKg: 10, pricePerKg: 11500 },
  { ekspedisi: "J&T Express", minKg: 10, maxKg: 50, pricePerKg: 8800 },
  { ekspedisi: "J&T Express", minKg: 50, maxKg: Infinity, pricePerKg: 6800 },
  { ekspedisi: "SiCepat", minKg: 0, maxKg: 10, pricePerKg: 11800 },
  { ekspedisi: "SiCepat", minKg: 10, maxKg: 50, pricePerKg: 8900 },
  { ekspedisi: "SiCepat", minKg: 50, maxKg: Infinity, pricePerKg: 6900 },
  { ekspedisi: "Ninja Express", minKg: 0, maxKg: 10, pricePerKg: 11000 },
  { ekspedisi: "Ninja Express", minKg: 10, maxKg: 50, pricePerKg: 8500 },
  { ekspedisi: "Ninja Express", minKg: 50, maxKg: Infinity, pricePerKg: 6500 },
  { ekspedisi: "Lion Parcel", minKg: 0, maxKg: 10, pricePerKg: 10500 },
  { ekspedisi: "Lion Parcel", minKg: 10, maxKg: 50, pricePerKg: 8200 },
  { ekspedisi: "Lion Parcel", minKg: 50, maxKg: Infinity, pricePerKg: 6200 },
  { ekspedisi: "Truk Sewa Sendiri", minKg: 0, maxKg: Infinity, pricePerKg: 4000 },
];

export const EKSPEDISI_LIST = ["JNE", "J&T Express", "SiCepat", "Ninja Express", "Lion Parcel", "Truk Sewa Sendiri"];
