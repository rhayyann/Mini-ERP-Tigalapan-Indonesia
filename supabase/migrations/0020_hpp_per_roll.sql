-- Fondasi "Close per Roll" + HPP per roll (sesuai Template HPP.xlsx Finance) -- lihat plan sesi
-- 2026-09-07. Sebelum ini, hasil produksi AKTUAL (Finish Good) dicatat vendor per GRUP warna+lengan
-- (production_results, bebas ketik), bukan per roll -- jadi HPP tidak bisa menelusuri roll bahan
-- baku SPESIFIK mana yang menghasilkan pcs mana (harga per roll bisa beda, mis. roll pengganti
-- klaim retur). Sekarang ditambahkan: (1) hasil FG AKTUAL per roll (production_batch_fg_sizes,
-- paralel persis production_batch_sizes yang sudah menyimpan TARGET cutting), (2) status "roll
-- ditutup" (production_batches.closed_at), (3) roll mana saja yang mengisi 1 koli pengiriman
-- (delivery_koli_batches -- roll SELALU dikirim utuh, dikonfirmasi user, jadi tidak perlu kolom
-- qty), (4) ongkir yang di-set vendor PER BATCH pengiriman (delivery_kolis.ongkir_batch),
-- menggantikan auto-hitung tarif ekspedisi sebagai sumber HPP (field ekspedisi/berat_koli lama
-- tetap ada untuk histori/tampilan, tidak dihapus).
--
-- Data LAMA (roll yang sudah selesai sebelum migration ini) tidak akan punya closed_at/baris di
-- delivery_koli_batches -- laporan HPP tetap fallback ke jalur pool lama untuk MRP itu (lihat
-- lib/mrp/derive.ts hppRowsForInvoice vs hppRowsForInvoicePerRoll).

create table if not exists production_batch_fg_sizes (
  id bigint generated always as identity primary key,
  production_batch_id text not null references production_batches(id) on delete cascade,
  size text not null,
  qty numeric not null default 0
);
create index if not exists production_batch_fg_sizes_batch_idx on production_batch_fg_sizes(production_batch_id);

alter table production_batches add column if not exists closed_at timestamptz;

create table if not exists delivery_koli_batches (
  id bigint generated always as identity primary key,
  delivery_koli_id text not null references delivery_kolis(id) on delete cascade,
  production_batch_id text not null references production_batches(id) on delete cascade,
  unique (production_batch_id)
);
create index if not exists delivery_koli_batches_koli_idx on delivery_koli_batches(delivery_koli_id);

alter table delivery_kolis add column if not exists ongkir_batch numeric;

create or replace function get_flow_snapshot_raw()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'mrp', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from mrp t),
    'lengan_groups', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from lengan_groups t),
    'lengan_group_sizes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from lengan_group_sizes t),
    'aduan_pola_rows', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from aduan_pola_rows t),
    'aduan_pola_sizes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from aduan_pola_sizes t),
    'material_rows', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from material_rows t),
    'material_pos', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from material_pos t),
    'material_po_color_breakdown', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from material_po_color_breakdown t),
    'material_po_invoiced_by_color', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from material_po_invoiced_by_color t),
    'maklon_pos', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from maklon_pos t),
    'maklon_po_cancelled_lines', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from maklon_po_cancelled_lines t),
    'raw_material_invoices', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from raw_material_invoices t),
    'raw_material_invoice_colors', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from raw_material_invoice_colors t),
    'raw_material_invoice_rolls', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from raw_material_invoice_rolls t),
    'raw_material_invoice_addbuys', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from raw_material_invoice_addbuys t),
    'maklon_invoices', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from maklon_invoices t),
    'production_batches', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_batches t),
    'production_batch_sizes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_batch_sizes t),
    'production_batch_fg_sizes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_batch_fg_sizes t),
    'production_yield_resolutions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_yield_resolutions t),
    'production_results', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_results t),
    'production_result_sizes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_result_sizes t),
    'production_group_meta', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_group_meta t),
    'delivery_kolis', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from delivery_kolis t),
    'delivery_koli_items', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from delivery_koli_items t),
    'delivery_koli_batches', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from delivery_koli_batches t),
    'vendor_invoices', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from vendor_invoices t),
    'vendor_invoice_lines', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from vendor_invoice_lines t),
    'vendor_invoice_adjustments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from vendor_invoice_adjustments t),
    'material_claim_history', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from material_claim_history t),
    'vendor_deposits', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from vendor_deposits t),
    'vendors_produksi', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kategori', kategori, 'base_capacity', base_capacity)), '[]'::jsonb) from vendors_produksi),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from notifications t),
    'harga_maklon', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_maklon t),
    'harga_kain', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_kain t),
    'harga_kain_pks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_kain_pks t),
    'entitas', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from entitas t),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from suppliers t)
  );
$$;
