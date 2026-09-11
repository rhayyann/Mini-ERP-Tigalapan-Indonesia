-- Item 2026-09-11 (user-reported: tampilan vendor sempat menunjukkan kode mentah "GI-01" alih-alih
-- nama lengkapnya "Yogi 01"; sekaligus permintaan menyeragamkan tampilan nama vendor jadi UPPERCASE
-- di semua halaman). `vendors_produksi.name` adalah sumber PRIORITAS untuk `vendorProduksiRows`
-- (lib/mrp/derive.ts:371, dbMeta?.name lebih diutamakan dari VENDOR_PRODUKSI[vendor]?.name statis
-- di lib/mrp/seed.ts) -- keduanya harus tetap sinkron kapitalisasinya, jadi kolom ini ikut
-- di-uppercase supaya konsisten dengan seed.ts (lihat komentar di file itu). Login vendor tidak
-- terpengaruh (dicocokkan lewat `id`, bukan `name`).
update vendors_produksi set name = upper(name);
