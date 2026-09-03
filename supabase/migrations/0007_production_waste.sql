-- Reject yang dibuang jadi sisa/majun/kain perca (tidak bisa dirework jadi baju) — dulu cuma ada
-- 'FG'/'REJECT', sekarang tambah 'WASTE' supaya bisa dibedakan dari reject yang masih dirework.
-- Lihat wasteRejectSizeAction di lib/mrp/actions.ts.
alter type production_kind_t add value if not exists 'WASTE';
