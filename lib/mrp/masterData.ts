/** Tipe untuk data "Master Data" — daftar referensi (harga maklon, harga kain, entitas, supplier)
 *  yang tadinya cuma ada di spreadsheet terpisah atau hardcode statis (lib/mrp/seed.ts), sekarang
 *  jadi data yang bisa diimpor sekali dari Google Sheets (publish-to-web CSV, lihat
 *  lib/mrp/importGoogleSheet.ts) lalu dikelola (tambah/edit/hapus) langsung dari halaman Master
 *  Data masing-masing modul (Procurement/Finance) di dalam store (lib/mrp/store.ts).
 *
 *  PENTING (lihat plan): di fase ini, tabel Harga Maklon / Harga Kain / Harga Kain PKS MURNI
 *  data referensi — belum dipakai otomatis oleh kalkulasi PO/invoice manapun. `ratePerPc` di
 *  VENDOR_PRODUKSI (seed.ts) dan MATERIAL_RATE_PER_ROLL (store.ts) tetap dipakai apa adanya untuk
 *  kalkulasi yang sudah ada. Auto-lookup dari tabel ini ke kalkulasi adalah pekerjaan fase
 *  berikutnya yang terpisah. */

/** Harga maklon (ongkos jahit) per vendor produksi — bertingkat berdasarkan kapasitas kumulatif
 *  ("Standar" = harga dasar flat, "PKS" = harga khusus kalau kapasitas mencapai rentang
 *  kapasitasMin–kapasitasMax). `tipeLengan` SENGAJA string bebas (bukan tipe `Lengan` yang cuma
 *  "PENDEK"|"PANJANG") karena sheet sumber juga punya kategori "Wangky PDK"/"Wangky PJG" yang
 *  belum dikenal sistem — supaya baris itu tidak ditolak/hilang saat import, cuma jadi data inert
 *  sampai ada fitur kategori produk itu. */
export type HargaMaklonRow = {
  id: string;
  kodeVendor: string;
  namaVendor: string;
  tipeLengan: string;
  jenisHarga: "Standar" | "PKS";
  kapasitasMin?: number;
  kapasitasMax?: number;
  harga: number;
};

/** Harga kain/material flat per kg, per supplier + kategori kain + warna. */
export type HargaKainRow = {
  id: string;
  kodeSupplier: string;
  namaSupplier: string;
  kategori: string;
  warna: string;
  hargaPerKg: number;
};

/** Harga kain PKS — sama seperti HargaKainRow tapi bertingkat berdasarkan tonase (per SATUAN,
 *  biasanya "TON"). Kalau order tidak mencapai tonaseMin manapun, fallback ke HargaKainRow biasa
 *  (aturan bisnis dari user — belum diimplementasikan sebagai lookup otomatis di fase ini). */
export type HargaKainPksRow = {
  id: string;
  kodeSupplier: string;
  kategori: string;
  warna: string;
  satuan: string;
  tonaseMin?: number;
  tonaseMax?: number;
  hargaPerKg: number;
};

export type EntitasRow = { id: string; nama: string };
export type SupplierRow = { id: string; nama: string };
