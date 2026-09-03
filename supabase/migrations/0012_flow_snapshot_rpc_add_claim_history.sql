-- Tambahkan material_claim_history (migration 0011) ke get_flow_snapshot_raw() (migration 0008)
-- -- tanpa ini, jalur RPC cepat tidak akan pernah mengembalikan data tabel baru itu (fallback ke
-- 32-query lama TETAP menyertakannya karena query per-tabelnya baru, lihat
-- lib/mrp/repo/snapshot.ts, tapi jalur RPC yang biasanya aktif perlu function-nya diperbarui juga).
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
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from notifications t),
    'harga_maklon', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_maklon t),
    'harga_kain', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_kain t),
    'harga_kain_pks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_kain_pks t),
    'entitas', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from entitas t),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from suppliers t)
  );
$$;
