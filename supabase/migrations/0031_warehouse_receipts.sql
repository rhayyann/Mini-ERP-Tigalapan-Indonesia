-- Spec: Portal Warehouse (Penerimaan & Bongkar Koli dari Vendor Produksi), bagian B.
--
-- Entitas internal BARU "Warehouse" menerima koli barang jadi (FG) kiriman Vendor Produksi lalu
-- "membongkar" koli itu jadi item stok gudang -- HANYA boleh dibongkar kalau HPP item-item di
-- dalamnya sudah difinalkan Finance (lihat migration 0030 & warehouseReceivableGroups,
-- lib/mrp/derive.ts). Bongkar SELALU per RESI GROUP dan SELALU UTUH (Q5 final -- TIDAK ada bongkar
-- sebagian/koreksi qty/klaim selisih), jadi 1 resi group = tepat 1 warehouse_receipt.
--
-- Non-goal eksplisit: TIDAK ada stok gudang BERJALAN (Q4) -- tabel-tabel ini murni ARSIP
-- penerimaan (apa yang masuk, kapan, berapa HPP-nya saat itu), bukan ledger stok keluar-masuk.
create table if not exists warehouse_receipts (
  id text primary key,
  resi_group_id text not null unique,
  mrp_id text not null,
  vendor_produksi text not null,
  -- Diisi kalau SELURUH item receipt ini bisa ditelusuri ke TEPAT SATU invoice vendor (kasus
  -- umum) -- kosong kalau gabungan >1 invoice (tetap valid, cuma tidak ada 1 nomor representatif
  -- tunggal). Dipakai juga oleh unfinalizeHppForInvoiceAction untuk menolak "Batalkan Final" pada
  -- invoice yang kolinya sudah dibongkar.
  vendor_invoice_id text,
  received_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);

-- Koli mana saja (dari resi group ini) yang tercakup dalam 1 receipt -- 1 resi group bisa berisi
-- >1 koli (migration 0026, resi_group_id).
create table if not exists warehouse_receipt_kolis (
  id bigserial primary key,
  warehouse_receipt_id text not null references warehouse_receipts(id),
  delivery_koli_id text not null
);

-- 1 baris = 1 DeliveryKoliItem apa adanya (qty di sini SELALU sama dengan qty aslinya di
-- delivery_koli_items -- lihat catatan warehouseReceivableGroups di lib/mrp/derive.ts) --
-- `hpp_per_item` adalah SNAPSHOT (nilai HPP live saat dibongkar, disimpan permanen, TIDAK dihitung
-- ulang lagi sesudahnya) supaya nilai stok gudang stabil secara akuntansi walau Laporan HPP
-- Finance tetap live seperti biasa (dua angka ini boleh berbeda, itu disengaja).
create table if not exists warehouse_receipt_items (
  id bigserial primary key,
  warehouse_receipt_id text not null references warehouse_receipts(id),
  delivery_koli_id text not null,
  warna text not null,
  lengan text not null,
  size text not null,
  kind text not null,
  qty integer not null,
  hpp_per_item numeric not null,
  source_batch_id text
);

create index if not exists warehouse_receipts_resi_group_idx on warehouse_receipts(resi_group_id);
create index if not exists warehouse_receipt_items_receipt_idx on warehouse_receipt_items(warehouse_receipt_id);
