-- Fix: list "Approve"/"Terima" di banyak halaman (PO Approval Finance, Good Receive vendor, dkk)
-- kelihatan lompat-lompat urutannya begitu 1 baris disentuh (mis. pilih entitas di dropdown) --
-- padahal actionnya (approve/terima) sendiri BELUM diklik. Owner: "list yang disetujui atau
-- diterima itu jangan buat listnya langsung berubah (langsung naik yang belum dipilih
-- actionnya)... kayaknya ada juga di bagian vendor produksi".
--
-- Akar masalahnya: get_flow_snapshot_raw() (migration 0008, terakhir di-redefine di 0020) & fungsi
-- fallback fetchFlowRowsLegacy (lib/mrp/repo/snapshot.ts) SELALU `select * from <table>` /
-- `jsonb_agg(to_jsonb(t))` TANPA `order by` sama sekali -- Postgres TIDAK menjamin urutan baris
-- untuk query tanpa ORDER BY, dan urutan itu BISA BERUBAH begitu ada baris yang di-UPDATE (baris
-- yang baru saja ditulis bisa pindah posisi fisik). Karena hampir semua aksi di app ini
-- (assignMaterialSupplier, setMaterialPoColorEntity, markRollArrived, dst) langsung memicu
-- backgroundRefresh() yang fetch ulang snapshot, SATU dropdown yang disentuh bisa membuat SELURUH
-- list re-order di render berikutnya -- persis gejala "melompat" yang dilaporkan.
--
-- Fix: kasih SEMUA subquery snapshot urutan yang STABIL & deterministik (created_at/timestamp
-- "sekali isi saat insert" kalau tabelnya punya, else primary key) -- supaya baris HANYA pindah
-- posisi kalau memang ada baris baru/terhapus, bukan tiap kali ada field yang diedit.
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
    'material_claim_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from material_claim_history t),
    'vendor_deposits', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at, t.id), '[]'::jsonb) from vendor_deposits t),
    'vendors_produksi', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kategori', kategori, 'base_capacity', base_capacity) order by id), '[]'::jsonb) from vendors_produksi),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t) order by t.time, t.id), '[]'::jsonb) from notifications t),
    'harga_maklon', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_maklon t),
    'harga_kain', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kain t),
    'harga_kain_pks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from harga_kain_pks t),
    'entitas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from entitas t),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from suppliers t)
  );
$$;
