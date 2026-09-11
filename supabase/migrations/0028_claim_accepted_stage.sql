-- Flow klaim material bertahap (Procurement, 2026-09-11): Terima Klaim -> Buat PV Pengganti ->
-- Tandai Sudah Dikirim (lihat A1-A9 di .pipeline/spec.md). Dua stage baru di MaterialClaimStage
-- (KLAIM_DITERIMA, PV_DIBUAT, lib/mrp/derive.ts) butuh 3 kolom baru:
--
-- - `claim_accepted_at` (roll) -- ditulis acceptMaterialClaimAction ("Terima Klaim", step 1).
--   Wajib terisi sebelum createClaimReplacementInvoiceAction ("Buat PV Pengganti") bisa dipakai
--   (gate ditegakkan di server, lihat A7).
-- - `claim_replacement_invoice_id` + `claim_replacement_at` (roll) -- ditulis
--   createClaimReplacementInvoiceAction begitu PV pengganti dibuat (step 2), DIBACA ULANG oleh
--   markClaimReplacementShippedAction (step 3) untuk tahu invoice PV pengganti mana yang perlu
--   dipindah ke DELIVERY. Sengaja disimpan di baris ROLL (bukan hanya arsip
--   material_claim_history) karena materialClaimStage/snapshot mapper (repo/snapshot.ts) cuma
--   membaca kolom roll untuk membentuk FlowState per-klaim -- arsip tidak ikut ke situ.
--
-- `material_claim_history.accepted_at` -- padanan arsip untuk claim_accepted_at (diisi
-- acceptMaterialClaimAction lewat findOpenClaimHistoryId, soft-fail seperti kolom arsip lain).
--
-- Idempotent (add column if not exists) -- aman dijalankan ulang. TIDAK menyentuh
-- get_flow_snapshot_raw() (RPC-nya select via to_jsonb(t), kolom baru di tabel existing ikut
-- otomatis).
alter table raw_material_invoice_rolls add column if not exists claim_accepted_at date;
alter table raw_material_invoice_rolls add column if not exists claim_replacement_invoice_id text;
alter table raw_material_invoice_rolls add column if not exists claim_replacement_at date;

alter table material_claim_history add column if not exists accepted_at date;
