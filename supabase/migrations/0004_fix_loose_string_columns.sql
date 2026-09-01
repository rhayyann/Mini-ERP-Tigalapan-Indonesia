-- Perbaikan tipe kolom: beberapa field di app lama menyimpan STRING BEBAS (bukan tanggal/waktu
-- sungguhan) -- migrasi 0001 sempat salah menganggapnya date/timestamptz. Diperbaiki di sini
-- (bukan mengedit 0001 yang sudah dijalankan) supaya riwayat migrasi tetap linear.
--
-- - mrp.target_date: app menyimpan placeholder literal "-" (belum ada fitur edit target
--   tanggal per-MRP), bukan tanggal asli -- jadi harus text, bukan date.
-- - notifications.time & maklon_po_cancelled_lines.time: app menyimpan JAM SAJA ("HH:mm", dari
--   helper now() di lib/mrp/store.ts), bukan timestamp lengkap -- harus text, bukan timestamptz.
alter table mrp alter column target_date drop not null;
alter table mrp alter column target_date type text using target_date::text;

alter table notifications alter column time type text using time::text;
alter table notifications alter column time drop default;

alter table maklon_po_cancelled_lines alter column time type text using time::text;
