-- Spec: kolom KERAH & MANSET (khusus kategori Excel "WANGKI MYNO"), mengikuti pola RIB KILOGRAM
-- yang sudah ada (rib_kg di lengan_groups/material_rows) sampai masuk COGS Bahan lewat Add Buy.
-- Kolom baru murni ADDITIVE (default 0, not null) -- baris/MRP lama otomatis kerah_kg/manset_kg = 0,
-- tidak perlu migrasi data historis (lihat Non-goals di spec).
alter table lengan_groups add column kerah_kg numeric not null default 0, add column manset_kg numeric not null default 0;
alter table material_rows add column kerah_kg numeric not null default 0, add column manset_kg numeric not null default 0;

-- TIDAK perlu redefine get_flow_snapshot_raw() -- RPC itu mengambil lengan_groups/material_rows
-- lewat `to_jsonb(t)` (lihat 0021_stable_snapshot_order.sql / 0032_snapshot_warehouse.sql), jadi
-- kolom baru otomatis ikut terbawa tanpa perlu disebut eksplisit.
