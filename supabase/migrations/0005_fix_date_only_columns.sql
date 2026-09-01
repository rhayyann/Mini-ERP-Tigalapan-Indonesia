-- Perbaikan lanjutan tipe kolom: BANYAK field "tanggal" di app lama sebenarnya cuma tanggal
-- polos (dari helper today() -> "YYYY-MM-DD", TANPA jam) -- migrasi 0001 salah menganggapnya
-- timestamptz. Efeknya: PostgREST mengembalikannya sebagai timestamp lengkap ber-zona
-- ("2026-09-01T00:00:00+00:00"), yang bikin formatter tanggal di UI (yang mengharap format
-- "YYYY-MM-DD" persis seperti today()) menghasilkan teks berantakan.
--
-- Satu-satunya kolom yang MEMANG timestamp lengkap (dari helper nowIso(), bukan today()) dan
-- TETAP timestamptz: production_results.recorded_at.
alter table mrp
  alter column created_at type date using created_at::date,
  alter column created_at drop default,
  alter column ppic_submitted_at type date using ppic_submitted_at::date,
  alter column ppic_approved_at type date using ppic_approved_at::date,
  alter column po_sent_at type date using po_sent_at::date,
  alter column po_approved_at type date using po_approved_at::date,
  alter column first_invoice_at type date using first_invoice_at::date,
  alter column first_payment_at type date using first_payment_at::date;

alter table raw_material_invoices
  alter column booked_at type date using booked_at::date,
  alter column booked_at drop default,
  alter column paid_at type date using paid_at::date,
  alter column delivered_at type date using delivered_at::date,
  alter column received_at type date using received_at::date,
  alter column production_start type date using production_start::date,
  alter column production_end type date using production_end::date;

alter table raw_material_invoice_rolls
  alter column received_at type date using received_at::date;

alter table raw_material_invoice_rolls
  alter column claim_resolved_at type date using claim_resolved_at::date,
  alter column claim_retur_requested_at type date using claim_retur_requested_at::date;

alter table raw_material_invoice_addbuys
  alter column received_at type date using received_at::date;

alter table maklon_invoices
  alter column submitted_at type date using submitted_at::date,
  alter column submitted_at drop default,
  alter column approved_at type date using approved_at::date,
  alter column paid_at type date using paid_at::date;

alter table production_batches
  alter column resting_at type date using resting_at::date,
  alter column cutting_at type date using cutting_at::date,
  alter column created_at type date using created_at::date,
  alter column created_at drop default;

alter table delivery_kolis
  alter column delivered_at type date using delivered_at::date,
  alter column created_at type date using created_at::date,
  alter column created_at drop default;

alter table vendor_invoices
  alter column submitted_at type date using submitted_at::date,
  alter column submitted_at drop default,
  alter column approved_at type date using approved_at::date,
  alter column paid_at type date using paid_at::date;

alter table vendor_invoice_adjustments
  alter column added_at type date using added_at::date,
  alter column added_at drop default;

-- Belum dipakai action manapun yang sudah diporting (markProductionGroupDone belum diporting),
-- tapi sumbernya juga today() di kode asli -- diperbaiki sekarang sekalian supaya konsisten
-- begitu action itu diporting nanti.
alter table production_group_meta
  alter column done_at type date using done_at::date;
