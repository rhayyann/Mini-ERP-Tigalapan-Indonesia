-- Owner-reported bug (2026-09-10, live): "Buat PV Pengganti" gagal untuk klaim FISIK dengan
-- error "Klaim ini tidak ditemukan di arsip atau sudah selesai" (Minified React error #441 di
-- production -- pesan asli baru kelihatan lewat network response body / dev environment).
--
-- Root cause: submitCuttingDefectClaimAction (klaim fisik, item 13/PR #52) TIDAK PERNAH menulis
-- ke material_claim_history (arsip klaim, migration 0011) sama sekali -- cuma menulis ke
-- raw_material_invoice_rolls (live). findOpenClaimHistoryId (dipakai
-- createClaimReplacementInvoiceAction) SELALU mengembalikan null untuk klaim FISIK karena baris
-- arsipnya memang tidak pernah dibuat -- "Buat PV Pengganti" (satu-satunya aksi klaim yang
-- BENAR-BENAR mewajibkan baris arsip ada, bukan cuma soft-fail seperti Minta Retur/Selesai)
-- SELALU gagal untuk klaim fisik. Aksi lain (Minta Retur, Selesai, Batalkan) tidak terpengaruh
-- (arsipnya sudah soft-fail by design), cuma diam-diam tidak tercatat di Riwayat/Arsip.
--
-- claimed_net_kg/diff_kg/pct sebelumnya NOT NULL -- tabel ini awalnya (migration 0011) murni
-- untuk klaim BERAT (selisih timbang), 3 kolom ini tidak punya padanan berarti untuk klaim
-- FISIK (tidak ada "berat yang diklaim"/"selisih") -- dibuat nullable supaya baris klaim FISIK
-- bisa disimpan tanpa nilai berat palsu (mis. 0, yang keliru terbaca sebagai "sesuai toleransi").
alter table material_claim_history alter column claimed_net_kg drop not null;
alter table material_claim_history alter column diff_kg drop not null;
alter table material_claim_history alter column pct drop not null;

-- `reason` membedakan 2 jenis klaim di arsip (dulu tabel ini murni klaim berat, kolom ini tidak
-- perlu ada) -- default 'BERAT' supaya baris LAMA (semuanya klaim berat, dibuat sebelum kolom
-- ini ada) otomatis benar tanpa backfill manual. `defect_note` menyimpan keterangan cacat fisik
-- (padanan diff_kg/pct untuk klaim berat) -- kosong untuk klaim BERAT.
alter table material_claim_history add column if not exists reason text not null default 'BERAT';
alter table material_claim_history add column if not exists defect_note text;
