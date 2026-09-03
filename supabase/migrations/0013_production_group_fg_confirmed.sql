-- "Selesai Produksi" sebelumnya cuma 1 tahap (production_group_meta.done_at), dipicu dari tab
-- Final Produksi -- di titik itu SEKALIGUS: (a) reject dihitung otomatis (cutting dikurangi
-- Finish Good), DAN (b) grup langsung terkunci (Rework/Buang ke Sisa ditolak, lihat guard di
-- reworkRejectSizeAction/wasteRejectSizeAction). Masalahnya: alur produksi yang benar butuh JEDA
-- di antara keduanya -- reject yang baru dihitung itu masih perlu di-REWORK dulu (reject jadi
-- baju ukuran lain) SEBELUM benar-benar final, tapi (b) sudah keburu mengunci di saat yang sama.
--
-- Sekarang dipecah jadi 2 tahap:
--   1. fg_confirmed_at -- "Selesai Produksi" di tab FINISH GOOD. Reject dihitung di sini. Rework/
--      Buang ke Sisa TETAP boleh jalan sesudahnya.
--   2. done_at (sudah ada) -- "Selesai Produksi" di tab FINAL PRODUKSI, SETELAH rework (kalau
--      ada) juga selesai. Baru di titik ini grup benar-benar terkunci & boleh masuk Pengiriman.
alter table production_group_meta
  add column if not exists fg_confirmed_at date;
