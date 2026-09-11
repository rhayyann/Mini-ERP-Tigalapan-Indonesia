-- Feedback 2026-09-11 (owner): "Checkbox Koli yang mau dikirim (disamakan ekspedisinya - jadi
-- satu resi). Dan ketika sudah final pengiriman nanti akan ada button submit invoice ... Buat
-- ada input nomor resi, saat ini masih tergabung di keterangan".
--
-- Dikonfirmasi lewat AskUserQuestion: berat TETAP diisi per koli (fisiknya beda-beda), tapi
-- ongkir yang DIBAYAR dihitung dari BERAT TOTAL seluruh koli se-grup (1x tarif ekspedisi
-- berjenjang berdasar 1x timbang di ekspedisi -- bukan dijumlah dari tarif per-koli terpisah
-- yang lebih mahal), diprorata balik per koli untuk catatan/histori. "Delivery" jadi SATU aksi
-- untuk seluruh grup sekaligus. Begitu grup terkirim penuh, "Submit Invoice" membuat invoice
-- vendor langsung dari isi koli grup itu -- section "Create Invoice" manual di Invoice & Payment
-- dihapus total (lihat components/vendor-maklon/invoice-vendor-panel.tsx).
--
-- `resi_group_id` MENYATUKAN >=1 koli yang dikirim bareng lewat SATU aksi "Set Ekspedisi & Resi"
-- (lihat setKoliEkspedisiResiGroupAction, actions.ts) -- SETIAP koli (termasuk yang dikirim
-- sendirian) SELALU dapat resi_group_id begitu ekspedisinya di-set, jadi "grup isi 1" adalah
-- kasus normal (bukan jalur khusus terpisah) di semua perhitungan ongkir/invoice yang baca
-- field ini (lihat koliOngkirShare, lib/mrp/derive.ts). Koli LAMA (sebelum migration ini,
-- resi_group_id NULL) tetap kebaca benar sebagai "grup isi 1" lewat fallback yang sama.
alter table delivery_kolis add column if not exists resi_group_id text;

-- `no_resi` (nomor resi/tracking dari ekspedisi) dulu tergabung bebas di `ekspedisi_note`
-- (migration 0024, field "Catatan ekspedisi") -- sekarang field TERSENDIRI, `ekspedisi_note`
-- murni jadi catatan bebas lagi (tidak ada migrasi data lama, no_resi kolom baru dimulai kosong).
alter table delivery_kolis add column if not exists no_resi text;

-- Menandai grup resi ini SUDAH pernah dibuatkan invoice vendor lewat "Submit Invoice" (lihat
-- submitResiGroupInvoiceAction) -- mencegah submit dobel untuk grup yang sama.
alter table delivery_kolis add column if not exists resi_invoiced_at timestamptz;

create index if not exists delivery_kolis_resi_group_idx on delivery_kolis(resi_group_id);
