-- Revisi 2026-09-06: klaim selisih berat sekarang bisa diselesaikan lewat "retur + pesan ulang"
-- (bukan cuma tukar roll fisik apa adanya) -- procurement pesan ulang bahan yang diretur dengan
-- HARGA TERKINI (ikut update harga supplier, TIDAK dikunci ke harga lama), lalu selisih antara
-- nilai pesanan baru dan nilai yang sudah dibayar di invoice lama untuk roll itu jadi:
--   - kekurangan yang harus ditagih (kalau nilai baru lebih besar), ATAU
--   - saldo deposit vendor (kalau nilai baru lebih kecil) -- lihat createClaimReplacementInvoiceAction
--     di lib/mrp/actions.ts.
--
-- Saldo deposit SENGAJA fungible per SUPPLIER (bukan per invoice pengganti) -- begitu tercatat,
-- bisa dipakai Finance untuk mengurangi pembayaran invoice APA PUN ke supplier yang sama, kapan
-- saja, sebagian atau seluruhnya, dipilih MANUAL tiap kali bayar (tidak pernah otomatis) -- lihat
-- applyVendorDepositAction & payment-panel.tsx. Ini keputusan eksplisit dari diskusi dengan owner,
-- bukan asumsi teknis.
--
-- Saldo = SUM(amount WHERE kind='CREDIT') - SUM(amount WHERE kind='DEBIT') per supplier, dihitung
-- LIVE lewat vendorDepositBalance() (lib/mrp/derive.ts) dari seluruh baris ledger ini -- sengaja
-- TIDAK disimpan sebagai 1 kolom running-total tersendiri di tabel lain, supaya tidak pernah ada 2
-- sumber kebenaran saldo yang bisa selisih satu sama lain.
create table if not exists vendor_deposits (
  id text primary key,
  supplier text not null,
  kind text not null, -- 'CREDIT' (masuk dari klaim diretur) | 'DEBIT' (dipakai bayar invoice)
  amount numeric not null, -- selalu POSITIF -- arah efeknya ke saldo ditentukan oleh `kind`
  source_claim_id text,      -- diisi untuk CREDIT: material_claim_history.invoice_id+warna+lengan+roll_index (claim key) asal kredit ini
  source_invoice_id text,    -- diisi untuk DEBIT: invoice yang pembayarannya memakai sebagian saldo ini
  note text,
  created_at timestamptz not null default now()
);
create index if not exists vendor_deposits_supplier_idx on vendor_deposits (supplier);

-- Penanda "invoice ini PV pengganti hasil klaim, bukan invoice baru murni" -- dipakai untuk
-- exclude dari demand planning MRP (kebutuhan roll/pcs untuk produksi itu sudah terhitung di
-- invoice ASLI yang diretur, ini cuma re-sourcing bukan demand tambahan) dan supaya laporan HPP
-- bisa mengembalikan biayanya ke MRP asal alih-alih menghitungnya sebagai biaya baru terpisah.
alter table raw_material_invoices add column if not exists source_claim_id text;

-- Link balik dari arsip klaim (migration 0011) ke PV pengganti yang dibuat untuk menyelesaikannya.
-- resolution_kind sudah kolom text bebas (bukan enum di DB, lihat comment migration 0011) -- nilai
-- baru 'RETUR_REORDER' dipakai langsung tanpa migrasi skema tambahan untuk kolom itu sendiri.
alter table material_claim_history add column if not exists replacement_invoice_id text;

-- Tambahkan vendor_deposits ke get_flow_snapshot_raw() (pola sama seperti migration
-- 0012_flow_snapshot_rpc_add_claim_history.sql) -- tabel ini kecil (nambah 1 baris per klaim yang
-- diretur+pesan ulang atau per pembayaran yang pakai saldo, bukan per-user/per-refresh), aman ikut
-- snapshot penuh -- beda dari invoice_payment_proofs/material_claim_photos (migration 0014/0017)
-- yang sengaja dikecualikan karena isinya file besar (data URI PDF/foto).
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
    'notifications', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from notifications t),
    'harga_maklon', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_maklon t),
    'harga_kain', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_kain t),
    'harga_kain_pks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from harga_kain_pks t),
    'entitas', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from entitas t),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from suppliers t)
  );
$$;
