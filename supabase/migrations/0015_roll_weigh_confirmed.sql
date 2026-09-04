-- Item 13 (feedback batch 2026-09-04): tahap "Konfirmasi" eksplisit yang menutup tahap timbang
-- sebelum roll bisa dipilih di Resting -- lihat confirmRollWeighAction di lib/mrp/actions.ts dan
-- weighedUnconfirmedRolls di lib/mrp/derive.ts. Kolom saja, tidak butuh perubahan RPC
-- (get_flow_snapshot_raw memakai to_jsonb(t) per tabel, jadi kolom baru ikut otomatis).
alter table raw_material_invoice_rolls add column if not exists weigh_confirmed_at timestamptz;

-- Backfill data lama: roll yang sudah pernah ditimbang (net_kg terisi) sebelum migration ini ada
-- dianggap sudah "dikonfirmasi" juga, supaya tidak tiba-tiba hilang dari daftar Resting begitu
-- gate baru ini aktif.
update raw_material_invoice_rolls
  set weigh_confirmed_at = now()
  where net_kg is not null and weigh_confirmed_at is null;
