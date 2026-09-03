-- Migration 0005 (fix_date_only_columns) menurunkan production_batches.resting_at/cutting_at
-- dari timestamptz jadi date -- IKUT KEBAWA padahal kolom ini SEHARUSNYA dikecualikan (sama
-- seperti production_results.recorded_at yang sengaja disebut TETAP timestamptz di comment
-- migration itu). Efeknya: bagian JAM & MENIT yang dipilih user di form "Resting"/"Update ke
-- Cutting" (components/mrp/production-cutting-tab.tsx, input type="datetime-local") langsung
-- dibuang saat disimpan -- yang tersisa cuma tanggal. Begitu dibaca lagi, tanggal-tanpa-jam itu
-- dianggap jam 00.00 UTC lalu dikonversi ke zona waktu browser, jadi SELALU tampil di jam yang
-- sama (mis. 08.00) apa pun jam aslinya -- dan karena resting_at & cutting_at sama-sama kena,
-- selisihnya (restingMinutes di lib/mrp/derive.ts, dipakai buat badge "RESTING KURANG DARI
-- TARGET") SELALU terhitung 0 menit, jadi badge itu nyala terus tanpa arti.
--
-- Kembalikan ke timestamptz seperti migration 0001 semula -- baris LAMA yang sudah kena
-- truncate (resting_at/cutting_at sama-sama jam 00.00) tidak bisa direkonstruksi (info jam
-- aslinya sudah hilang permanen), tapi baris BARU setelah migration ini jalan akan tersimpan &
-- ditampilkan dengan jam yang benar lagi.
alter table production_batches
  alter column resting_at type timestamptz using resting_at::timestamptz,
  alter column cutting_at type timestamptz using cutting_at::timestamptz;
