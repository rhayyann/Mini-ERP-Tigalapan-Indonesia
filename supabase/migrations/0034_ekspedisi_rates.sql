-- Master Data "Ekspedisi" (tarif ongkir FLAT per kg, live) -- menggantikan tarif tier hardcode
-- (EKSPEDISI_RATES/EKSPEDISI_LIST di lib/mrp/seed.ts, dihapus di kode sisi app) dengan tabel yang
-- bisa di-CRUD Procurement/Finance dari halaman Master Data, dan menjadi SATU-SATUNYA sumber tarif
-- ongkir dipakai LIVE di seluruh app (koliOngkirShare/ekspedisiPrice di lib/mrp/derive.ts): ongkir
-- 1 resi = harga/kg x total berat kg segrup (flat, TIDAK berjenjang/tier lagi seperti sebelumnya).
create table ekspedisi_rates (
  id text primary key,
  nama text not null unique,
  price_per_kg numeric not null default 0
);

-- RLS: sama pola tabel master data lain (harga_maklon dst, lihat 0001_init.sql) -- aktif, TANPA
-- policy (default deny untuk anon/authenticated, service role selalu bypass).
alter table ekspedisi_rates enable row level security;

-- Seed 7 baris awal (angka dari user -- ABN Rp 37.451/kg memang jauh lebih mahal dari yang lain,
-- di-seed apa adanya tanpa validasi khusus, lihat spec).
insert into ekspedisi_rates (id, nama, price_per_kg) values
  ('EKS-000001', 'DNC', 1700),
  ('EKS-000002', 'ANGKASA BUMI NUSANTARA (ABN)', 37451),
  ('EKS-000003', 'PERMAI TRANS', 2079),
  ('EKS-000004', 'SAMUDRA', 1350),
  ('EKS-000005', 'CITRA ANUGERAH SAMUDRA (CAS)', 1800),
  ('EKS-000006', 'WUS CARGO', 3000),
  ('EKS-000007', 'MALIBU', 3500);

-- Redefine get_flow_snapshot_raw() -- isi UTUH disalin dari 0032_snapshot_warehouse.sql (terakhir
-- yang me-redefine fungsi ini), TIDAK ada entri lama yang di-drop, cuma tambah 1 entri baru
-- 'ekspedisi_rates' di akhir (prinsip additive, lihat 0021_stable_snapshot_order.sql).
create or replace function get_flow_snapshot_raw()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'mrp', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from mrp t),
    'lengan_groups', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from lengan_groups t),
    'lengan_group_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from lengan_group_sizes t),
    'aduan_pola_rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from aduan_pola_rows t),
    'aduan_pola_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from aduan_pola_sizes t),
    'material_rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_rows t),
    'material_pos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from material_pos t),
    'material_po_color_breakdown', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_po_color_breakdown t),
    'material_po_invoiced_by_color', (select coalesce(jsonb_agg(to_jsonb(t) order by t.material_po_id, t.color_key), '[]'::jsonb) from material_po_invoiced_by_color t),
    'maklon_pos', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from maklon_pos t),
    'maklon_po_cancelled_lines', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from maklon_po_cancelled_lines t),
    'raw_material_invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.booked_at, t.id), '[]'::jsonb) from raw_material_invoices t),
    'raw_material_invoice_colors', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from raw_material_invoice_colors t),
    'raw_material_invoice_rolls', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from raw_material_invoice_rolls t),
    'raw_material_invoice_addbuys', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from raw_material_invoice_addbuys t),
    'maklon_invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id), '[]'::jsonb) from maklon_invoices t),
    'production_batches', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from production_batches t),
    'production_batch_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from production_batch_sizes t),
    'production_batch_fg_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from production_batch_fg_sizes t),
    'production_yield_resolutions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.production_batch_id), '[]'::jsonb) from production_yield_resolutions t),
    'production_results', (select coalesce(jsonb_agg(to_jsonb(t) order by t.recorded_at, t.id), '[]'::jsonb) from production_results t),
    'production_result_sizes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from production_result_sizes t),
    'production_group_meta', (select coalesce(jsonb_agg(to_jsonb(t) order by t.group_key), '[]'::jsonb) from production_group_meta t),
    'delivery_kolis', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from delivery_kolis t),
    'delivery_koli_items', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from delivery_koli_items t),
    'delivery_koli_batches', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from delivery_koli_batches t),
    'vendor_invoices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.submitted_at, t.id), '[]'::jsonb) from vendor_invoices t),
    'vendor_invoice_lines', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from vendor_invoice_lines t),
    'vendor_invoice_adjustments', (select coalesce(jsonb_agg(to_jsonb(t) order by t.added_at, t.id), '[]'::jsonb) from vendor_invoice_adjustments t),
    -- Migration 0031 (Portal Warehouse) -- 3 entri baru, `order by` stabil sama pola tabel lain.
    'warehouse_receipts', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from warehouse_receipts t),
    'warehouse_receipt_kolis', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from warehouse_receipt_kolis t),
    'warehouse_receipt_items', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from warehouse_receipt_items t),
    'material_claim_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_claim_history t),
    'vendor_deposits', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from vendor_deposits t),
    'vendors_produksi', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kategori', kategori, 'base_capacity', base_capacity) order by id), '[]'::jsonb) from vendors_produksi),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t) order by t.time, t.id), '[]'::jsonb) from notifications t),
    'harga_maklon', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_maklon t),
    'harga_kain', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kain t),
    'harga_kain_pks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kain_pks t),
    'entitas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from entitas t),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from suppliers t),
    'ekspedisi_rates', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from ekspedisi_rates t)
  );
$$;
