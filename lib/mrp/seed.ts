/** Daftar vendor produksi eksternal (maklon) — sumbernya daftar riil dari tim Procurement
 *  (spreadsheet "VENDOR / KODE VENDOR / PASSWORD"), di-hardcode di sini (bukan live-import
 *  seperti Harga Maklon/Harga Kain) karena isinya kredensial login, bukan cuma data harga —
 *  key record = KODE VENDOR dari spreadsheet, dipakai sebagai vendorId di seluruh app.
 *  BAYU & GI-01 SENGAJA mempertahankan key lama (bukan "BY" sesuai kode di spreadsheet) supaya
 *  data yang sudah tersimpan (PO, invoice, dsb — semua disimpan pakai vendorId string ini) tetap
 *  cocok; cuma `name`-nya yang diperbarui mengikuti nama asli di spreadsheet.
 *  `password` dipakai halaman login vendor (lihat app/vendor-maklon/login/page.tsx) — SEMUA
 *  vendor pakai password seragam "vendor123" sesuai spreadsheet.
 *  baseCapacity/ratePerPc/estDays/productionLeadDays untuk 8 vendor BARU (semua kecuali BAYU &
 *  GI-01) masih ANGKA PLACEHOLDER (belum ada datanya dari Procurement) — dipakai sebagai fallback
 *  terakhir kalau Master Data > Harga Maklon belum punya baris untuk vendor itu (lihat
 *  maklonAmountForVendor di lib/mrp/derive.ts). Update begitu rate & kapasitas riilnya tersedia. */
export const VENDOR_PRODUKSI: Record<
  string,
  { name: string; baseCapacity: number; ratePerPc: number; estDays: number; retentionPct: number; productionLeadDays: number; password: string }
> = {
  BAYU: { name: "Bayu", baseCapacity: 8500, ratePerPc: 7000, estDays: 14, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  "GI-01": { name: "Yogi 01", baseCapacity: 6200, ratePerPc: 6900, estDays: 11, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  "GI-02": { name: "Yogi 02", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  CE: { name: "Cecep", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  KK: { name: "Koko", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  CP: { name: "Custom Project", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  MKS: { name: "Konveksi Makassar", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  AWL: { name: "Awal", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  ART: { name: "Artha", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
  ELMN: { name: "Elang", baseCapacity: 5000, ratePerPc: 7000, estDays: 12, retentionPct: 10, productionLeadDays: 7, password: "vendor123" },
};

export const SUPPLIERS = ["Supplier Rajut Jaya", "Supplier ABC", "Supplier Cemerlang"];

// Fallback flat lama untuk estimasi PO Material — dipindah ke sini (dari lib/mrp/store.ts) supaya
// lib/mrp/derive.ts bisa memakainya sebagai fallback terakhir di hargaKainRate() tanpa bikin
// circular import (derive.ts sudah diimpor store.ts). Dipakai kalau supplier+warna suatu PO sama
// sekali tidak ada di Master Data > Harga Kain (lihat lib/mrp/masterData.ts).
export const MATERIAL_RATE_PER_ROLL = 460000;

export const ENTITAS_LIST = ["PT Tigalapan Sukses Indo", "PT Tigalapan Dua", "PT Tigalapan Tiga"];

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
