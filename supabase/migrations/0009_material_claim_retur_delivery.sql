-- Tahap baru di alur klaim retur material (app/procurement/material-claims/page.tsx):
-- Procurement "Minta Retur" ke supplier sudah ada (claim_retur_note/claim_retur_requested_at),
-- tapi tidak ada cara mencatat kalau supplier sudah kirim roll pengganti (biasanya dikabari lewat
-- WA) sebelum vendor benar-benar timbang ulang roll itu di Cutting -- padahal proses fisiknya
-- punya jeda "sudah dikirim, masih di jalan/menunggu diterima vendor" yang perlu kelihatan di ERP,
-- baik untuk Procurement (tracking) maupun vendor (tahu ada roll pengganti yang harus dicek).
--
-- claim_retur_delivered_at/_note : diisi Procurement, "roll pengganti sudah dikirim ke vendor".
-- claim_retur_received_at        : diisi vendor, "roll pengganti sudah diterima fisik" (dicatat
--                                   terpisah dari net_kg/timbang ulang -- konfirmasi terima bisa
--                                   duluan sebelum sempat ditimbang).
alter table raw_material_invoice_rolls
  add column if not exists claim_retur_delivered_note text,
  add column if not exists claim_retur_delivered_at date,
  add column if not exists claim_retur_received_at date;
