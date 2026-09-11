-- Spec: Portal Warehouse (Penerimaan & Bongkar Koli dari Vendor Produksi), bagian A ("Finalkan
-- HPP"). Sebelum ini, "sudah ada HPP-nya di Finance" untuk sebuah invoice vendor = otomatis true
-- begitu koli delivered + invoice-nya ada & bukan REVISION (dihitung LIVE, tidak pernah disimpan
-- ke DB -- lihat hppRowsForInvoicePerRoll di lib/mrp/derive.ts). Warehouse butuh sinyal EKSPLISIT
-- dari Finance ("saya sudah cek angka HPP invoice ini, boleh dibongkar") sebelum koli terkait
-- boleh dibongkar jadi stok gudang -- dua kolom ini itu sinyalnya.
--
-- Ini PENANDA, BUKAN LOCK: mengisi kolom ini TIDAK mengubah perilaku modul lain sama sekali --
-- cutting/rework/ongkir tetap boleh berubah dan Laporan HPP tetap dihitung LIVE seperti biasa
-- (lihat lib/mrp/actions.ts finalizeHppForInvoiceAction). Yang membuat angka HPP stabil secara
-- akuntansi adalah SNAPSHOT `hpp_per_item` di warehouse_receipt_items (migration 0031) saat
-- Warehouse benar-benar membongkar, bukan kolom ini.
--
-- `hpp_finalized_by` sengaja literal "finance" (sistem ini tidak punya akun user individual,
-- cuma role) -- kolomnya ada untuk jejak audit ke depan kalau suatu saat ditambah akun per-orang.
alter table vendor_invoices add column if not exists hpp_finalized_at timestamptz;
alter table vendor_invoices add column if not exists hpp_finalized_by text;

-- TIDAK perlu redefine get_flow_snapshot_raw() -- RPC itu mengambil vendor_invoices lewat
-- `to_jsonb(t)` (lihat 0021_stable_snapshot_order.sql), jadi kolom baru otomatis ikut terbawa
-- tanpa perlu disebut eksplisit.
