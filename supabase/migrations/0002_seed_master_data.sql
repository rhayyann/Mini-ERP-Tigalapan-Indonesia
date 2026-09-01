-- Seed data yang sebelumnya hardcode di lib/mrp/seed.ts, dipindah jadi baris tabel
-- supaya tersedia sebagai master data bersama di Supabase.

create extension if not exists pgcrypto;

-- Entitas (dulu: ENTITAS_LIST di lib/mrp/seed.ts) — tetap ditandai "data awal", boleh
-- diedit/diganti user lewat halaman Master Data begitu migrasi selesai.
insert into entitas (id, nama) values
  ('E1', 'PT Tigalapan Sukses Indo'),
  ('E2', 'PT Tigalapan Dua'),
  ('E3', 'PT Tigalapan Tiga');

-- Supplier (dulu: SUPPLIERS di lib/mrp/seed.ts)
insert into suppliers (id, nama) values
  ('S1', 'Supplier Rajut Jaya'),
  ('S2', 'Supplier ABC'),
  ('S3', 'Supplier Cemerlang');

-- Vendor produksi (maklon) — dulu VENDOR_PRODUKSI di lib/mrp/seed.ts. Semua vendor
-- pakai password seragam "vendor123" persis seperti sebelumnya, tapi sekarang disimpan
-- ter-hash (bcrypt via pgcrypto), dicek server-side lewat bcryptjs.compare() saat login
-- (format hash $2a$/$2b$ pgcrypto kompatibel dengan bcryptjs).
insert into vendors_produksi (id, name, base_capacity, rate_per_pc, est_days, retention_pct, production_lead_days, password_hash) values
  ('BAYU',  'Bayu',              8500, 7000, 14, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('GI-01', 'Yogi 01',           6200, 6900, 11, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('GI-02', 'Yogi 02',           5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('CE',    'Cecep',             5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('KK',    'Koko',              5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('CP',    'Custom Project',    5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('MKS',   'Konveksi Makassar', 5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('AWL',   'Awal',              5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('ART',   'Artha',             5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf'))),
  ('ELMN',  'Elang',             5000, 7000, 12, 10, 7, crypt('vendor123', gen_salt('bf')));

-- harga_maklon / harga_kain / harga_kain_pks SENGAJA dibiarkan kosong: di app lama,
-- tabel-tabel ini juga mulai kosong dan diisi lewat tombol "Import dari Google Sheets"
-- di masing-masing halaman Master Data (lib/mrp/importGoogleSheet.ts) — perilaku itu
-- dipertahankan, cuma target importnya sekarang Supabase, bukan localStorage.
