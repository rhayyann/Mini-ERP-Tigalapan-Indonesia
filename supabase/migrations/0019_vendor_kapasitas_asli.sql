-- Revisi 2026-09-06: data ASLI vendor produksi dari spreadsheet Procurement (VENDOR / KODE VENDOR /
-- KATEGORI / KAPASITAS PRODUKSI per minggu) -- sebelumnya kolom base_capacity di tabel ini SUDAH
-- ADA sejak migration 0001 tapi TIDAK PERNAH dibaca aplikasi manapun (dicek lewat grep), dan angka
-- di lib/mrp/seed.ts untuk 8 dari 10 vendor cuma placeholder ("belum ada datanya dari Procurement",
-- lihat komentar di file itu). Sekarang datanya ada -- base_capacity & kategori (kolom baru) jadi
-- SUMBER UTAMA (dibaca lewat getFlowSnapshot, lihat lib/mrp/repo/snapshot.ts), sementara ratePerPc/
-- estDays/retentionPct/productionLeadDays TETAP di seed.ts (tidak diminta berubah).
alter table vendors_produksi add column if not exists kategori text;

-- Id vendor SENGAJA tidak diubah (BAYU tetap "BAYU" walau kode di spreadsheet "BY", GI-01/GI-02
-- tetap dengan strip) -- supaya seluruh data yang sudah tersimpan (PO, invoice, dst, semua pakai
-- id ini sebagai foreign key) tidak perlu dimigrasikan. Lihat juga alias "BY" -> "BAYU" di
-- lib/mrp/parseImport.ts untuk sisi import Excel.
update vendors_produksi set kategori = 'PANJANG + RIB', base_capacity = 10000 where id = 'GI-01';
update vendors_produksi set kategori = 'PANJANG + RIB', base_capacity = 15000 where id = 'GI-02';
update vendors_produksi set kategori = 'TUNIK 24S', base_capacity = 25000 where id = 'BAYU';
update vendors_produksi set kategori = null, base_capacity = 10000 where id = 'CE';
update vendors_produksi set kategori = 'KIDS 24S', base_capacity = 10000 where id = 'KK';
update vendors_produksi set kategori = 'COMBED 30S', base_capacity = 5000 where id = 'CP';
update vendors_produksi set kategori = null, base_capacity = 10000 where id = 'MKS';
update vendors_produksi set kategori = 'WANGKI MYNO', base_capacity = 2500 where id = 'AWL';
update vendors_produksi set kategori = 'WANGKI MYNO', base_capacity = 2500 where id = 'ART';
update vendors_produksi set kategori = 'WANGKI MYNO', base_capacity = 5000 where id = 'ELMN';

-- Tambahkan vendors_produksi ke get_flow_snapshot_raw() (pola sama seperti migration 0018 untuk
-- vendor_deposits) -- HANYA kolom non-rahasia (id, name, kategori, base_capacity). password_hash
-- SENGAJA TIDAK diikutkan -- jangan pernah sampai ke client/browser lewat snapshot.
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
    'production_yield_resolutions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_yield_resolutions t),
    'production_results', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_results t),
    'production_result_sizes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_result_sizes t),
    'production_group_meta', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from production_group_meta t),
    'delivery_kolis', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from delivery_kolis t),
    'delivery_koli_items', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from delivery_koli_items t),
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
