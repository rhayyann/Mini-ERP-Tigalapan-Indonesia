-- Klaim selisih berat (app/procurement/material-claims/page.tsx) SELALU diturunkan LIVE dari
-- kolom di raw_material_invoice_rolls (net_kg vs gross_kg, claim_retur_*, claim_resolved_*) --
-- begitu roll ditimbang ulang & hasilnya sesuai toleransi, kolom-kolom itu di-null-kan lagi
-- (lihat receiveRawMaterialRollAction) supaya roll_index yang sama bisa mulai "bersih" kalau
-- suatu saat kena klaim lagi. Efeknya: begitu klaim selesai, TIDAK ADA JEJAK sama sekali kalau
-- roll itu pernah bermasalah -- user minta ada arsip/histori klaim yang sudah selesai & roll
-- penggantinya sudah diterima vendor, buat pencatatan.
--
-- Tabel baru ini adalah CATATAN TERPISAH (bukan sumber kebenaran status klaim aktif -- itu tetap
-- dari raw_material_invoice_rolls) yang mencatat siklus hidup 1 klaim dari awal (roll ditimbang
-- di luar toleransi) sampai selesai (auto-tertutup lewat timbang ulang sesuai toleransi, atau
-- ditutup manual "Selesai" oleh Procurement). Satu baris di sini = satu siklus klaim untuk 1 roll
-- (invoice_id+warna+lengan+roll_index) -- "resolved_at is null" berarti masih terbuka/aktif.
create table if not exists material_claim_history (
  id text primary key,
  invoice_id text not null,
  po_id text,
  mrp_id text,
  supplier text,
  vendor_produksi text,
  warna text not null,
  lengan text not null,
  roll_index int not null,
  code_roll text,
  code_lot text,
  gross_kg numeric not null,
  claimed_net_kg numeric not null,
  diff_kg numeric not null,
  pct numeric not null,
  claimed_at date not null default current_date,
  retur_note text,
  retur_requested_at date,
  retur_delivered_note text,
  retur_delivered_at date,
  retur_received_at date,
  resolved_at date,
  resolved_note text,
  resolution_kind text, -- 'AUTO_REWEIGH' | 'MANUAL'
  resolved_net_kg numeric,
  resolved_code_roll text
);

create index if not exists material_claim_history_open_idx
  on material_claim_history (invoice_id, warna, lengan, roll_index)
  where resolved_at is null;
