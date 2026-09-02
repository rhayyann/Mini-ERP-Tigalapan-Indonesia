-- Hasil aduan AKTUAL per roll (batch) yang dicatat vendor saat "Update ke Cutting" — dulu tidak
-- ada tempat menyimpan output cutting per roll sama sekali, cuma diestimasi (targetSizesForGroup
-- di lib/mrp/derive.ts, rasio roll dicutting vs roll rencana). Sekarang dicatat nyata per batch,
-- dipakai untuk target qty/yield per roll (lihat lib/mrp/derive.ts productionYieldAlertsList) dan
-- sebagai sumber "Total Qty" Finish Good (bukan lagi target MRP).
create table production_batch_sizes (
  id bigint generated always as identity primary key,
  production_batch_id text not null references production_batches(id) on delete cascade,
  size text not null,
  qty integer not null default 0
);
create index on production_batch_sizes(production_batch_id);

-- Alert yield per roll (<99%) yang dilempar ke portal internal Produksi untuk approval/tindak
-- lanjut — mirror pola material_claim_resolutions (raw_material_invoice_rolls.claim_resolved_*)
-- tapi untuk klaim yield, disimpan terpisah per production_batch (bukan kolom langsung di situ,
-- supaya production_batches tidak membengkak dengan kolom yang jarang terisi).
create table production_yield_resolutions (
  production_batch_id text primary key references production_batches(id) on delete cascade,
  note text not null,
  resolved_at timestamptz not null default now()
);
