import type { Lengan } from "./types";

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

/** Tarif ongkir ekspedisi, FLAT per kg (harga/kg x berat kg total 1 resi/grup pengiriman) --
 *  BEDA dari Harga Maklon/Harga Kain/Harga Kain PKS di atas (yang masih murni data referensi
 *  inert): tabel ini DIPAKAI LIVE oleh ekspedisiPrice/koliOngkirShare (lib/mrp/derive.ts) untuk
 *  menghitung ongkir yang tampil di halaman Pengiriman, Invoice Vendor, Payment Maklon, Laporan
 *  HPP, dan Penerimaan Warehouse -- menggantikan tarif tier hardcode lama (EKSPEDISI_RATES di
 *  lib/mrp/seed.ts, sudah dihapus). Matching nama EXACT (case-sensitive) ke `DeliveryKoli.ekspedisi`
 *  -- nama ekspedisi yang tidak ada di tabel ini menghasilkan ongkir Rp 0 (disengaja). */
export type EkspedisiRateRow = { id: string; nama: string; pricePerKg: number };

/** Harga jual per item (kategori/SKU/warna/lengan/size), di-seed SEKALI dari file "Item Library
 *  (Tigalapan).csv" (2026-09-13, 2.139 baris, 6 kategori yang dipakai alur MRP: COMBED 24S, COMBED
 *  30S, KIDS 24S, PANJANG + RIB, TUNIK 24S, WANGKI MYNO) -- dipakai UNTUK MENGHITUNG kolom "% HPP"
 *  di Laporan HPP (Finance). BUKAN Master Data live: TIDAK ADA CRUD/tombol import ulang/panel edit
 *  -- kalau harga berubah, perlu migration baru atau UPDATE manual lewat SQL Editor Supabase. */
export type ItemSellingPriceRow = {
  id: string;
  kategori: string;
  sku: string | null;
  itemName: string;
  warna: string;
  lengan: Lengan;
  size: string;
  price: number;
};

/** Master Data "Kerah/Manset" (konversi qty PCS -> kg + harga/kg, GLOBAL untuk semua warna kategori
 *  WANGKI MYNO, migration 0036) -- SELALU PERSIS 2 baris (`kind` "KERAH"/"MANSET"), tidak ada
 *  add/delete. Dipakai LIVE oleh `parseMrpImportFile` (lib/mrp/parseImport.ts) untuk mengonversi
 *  angka qty pcs mentah dari kolom Excel KERAH/MANSET jadi kg sungguhan, dan oleh PO Approval
 *  (app/procurement/po-approval/page.tsx) untuk estimasi nominal Rp (PURELY DISPLAY, tidak
 *  mengubah nilai PO Bahan aktual). */
export type KerahMansetSettingRow = { kind: "KERAH" | "MANSET"; kgPerPcs: number; hargaPerKg: number };

/** Revisi 2026-09-06: data ASLI vendor produksi dari spreadsheet Procurement (kategori & kapasitas
 *  produksi PER MINGGU) -- sumbernya kolom `kategori`/`base_capacity` di tabel `vendors_produksi`
 *  (lihat migration 0019_vendor_kapasitas_asli.sql). Nama sengaja BEDA dari `VendorProduksiRow` di
 *  derive.ts (itu row hasil AGREGASI qty per-MRP untuk 1 tampilan tertentu, bukan master data) --
 *  supaya tidak bentrok nama. `password_hash` SENGAJA tidak ada di sini -- itu cuma pernah dibaca
 *  server-only lewat loginVendorAction (lib/auth/actions.ts), tidak pernah ikut snapshot client. */
export type VendorProduksiMasterRow = {
  id: string;
  name: string;
  kategori?: string;
  weeklyCapacity: number;
};
