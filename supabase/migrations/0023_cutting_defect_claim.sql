-- Item 13 (feedback batch 2026-09-10, owner: "Saya ingin bisa di select rollnya (checkbox dan
-- bisa diajukan claim) karena di proses resting ini itu kita menghamparkan kain jadi bisa cek
-- jika ada cacat material selain dari claim berat toleransi (shading, kotor, dll)"): claim FISIK
-- (bukan selisih berat) yang ditemukan vendor saat menghamparkan roll untuk resting/cutting.
--
-- Sistem klaim yang SUDAH ADA (claim_resolved_*/claim_retur_*/claim_photo_at, migration
-- 0002/0009/0014) murni WEIGHT-based -- "roll ini sedang diklaim" diturunkan otomatis dari
-- weightVariance(gross_kg, net_kg), TIDAK ADA flag eksplisit "klaim diajukan" di kolom manapun.
-- Klaim fisik (shading/kotor/dll) TIDAK PUNYA selisih berat sama sekali, jadi butuh flag eksplisit
-- sendiri -- tapi begitu diajukan, ikut lifecycle retur/resolusi yang SAMA (claim_retur_*/
-- claim_resolved_*) karena Procurement menangani retur+replacement dengan cara yang sama terlepas
-- dari alasannya (lihat materialClaimsList, lib/mrp/derive.ts, yang sekarang ikut menyertakan
-- baris dengan claim_defect_at terisi, reason: "FISIK").
alter table raw_material_invoice_rolls add column if not exists claim_defect_note text;
alter table raw_material_invoice_rolls add column if not exists claim_defect_at timestamptz;
