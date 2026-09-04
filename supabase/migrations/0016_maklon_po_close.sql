-- Item 21 (feedback batch 2026-09-04): "Close PO" untuk siklus produksi parsial -- menutup satu
-- PO Produksi (mrp_id + vendor_produksi) sekaligus untuk semua warna/lengan-nya, lihat
-- closeProductionPoAction di lib/mrp/actions.ts. Sengaja TIDAK menambah nilai enum baru ke
-- MaklonPoStatus (maklon_po_status_t) supaya tidak perlu menyentuh semua badge map yang sudah ada
-- -- status "ditutup" cukup ditandai lewat closed_at terisi.
alter table maklon_pos add column if not exists closed_at date;
alter table maklon_pos add column if not exists close_reason text;
