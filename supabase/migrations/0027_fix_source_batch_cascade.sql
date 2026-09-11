-- BUG FIX 2026-09-11 (owner: "kenapa fitur reset data tidak bisa bekerja?", ditemukan lewat log
-- Vercel setelah PR #60 menambahkan pengecekan error eksplisit di resetAllAction):
--
--   Error: update or delete on table "production_batches" violates foreign key constraint
--   "delivery_koli_items_source_batch_id_fkey" on table "delivery_koli_items"
--
-- Root cause: migration 0024 menambahkan `delivery_koli_items.source_batch_id` sebagai FK ke
-- production_batches(id) TANPA `on delete cascade` (default Postgres: NO ACTION). Reset data
-- menghapus `mrp`, yang di-desain untuk cascade ke SEMUA turunannya termasuk production_batches
-- (lewat mrp_id) DAN delivery_koli_items (lewat delivery_kolis -> mrp). Tapi karena FK
-- source_batch_id TIDAK cascade, Postgres menolak menghapus production_batches selama masih ada
-- baris delivery_koli_items yang menunjuk ke situ lewat source_batch_id -- gagal DI TENGAH
-- transaksi delete `mrp`, bukan cuma soal resetAllAction (bulk-delete APAPUN yang menyentuh
-- production_batches lewat cascade mrp akan kena masalah yang sama, reset data cuma yang pertama
-- ketemu karena jalur satu-satunya yang benar-benar menghapus mrp secara massal).
--
-- Fix: ganti FK-nya jadi ON DELETE CASCADE -- kalau production_batches-nya dihapus (baik lewat
-- reset, atau cascade mrp normal), baris delivery_koli_items yang menunjuk ke situ WAJAR ikut
-- terhapus juga (bukan "yatim" yang menunjuk ke roll yang sudah tidak ada). Aman untuk jalur
-- delete production_batches LAIN yang sudah ada (klaim fisik roll "resting", lib/mrp/actions.ts
-- ~line 1400) -- batch yang masih "resting" (belum dikirim) TIDAK PERNAH punya delivery_koli_items
-- yang menunjuk ke situ, jadi cascade di situ tidak pernah benar-benar memicu apa pun ekstra.
alter table delivery_koli_items drop constraint if exists delivery_koli_items_source_batch_id_fkey;
alter table delivery_koli_items
  add constraint delivery_koli_items_source_batch_id_fkey
  foreign key (source_batch_id) references production_batches(id) on delete cascade;
