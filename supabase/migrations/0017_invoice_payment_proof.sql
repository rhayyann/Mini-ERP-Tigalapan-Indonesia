-- Item 2 (feedback batch 2026-09-05): Finance upload bukti pembayaran (PDF) saat/​setelah
-- membayar invoice material -- lihat setInvoicePaymentProofAction di lib/mrp/actions.ts.
--
-- `bukti_bayar_at` cuma FLAG murah (bukti sudah ada atau belum) yang ikut snapshot biasa --
-- payload-nya sendiri (data URI PDF, bisa ratusan KB) SENGAJA DIPISAH ke tabel
-- invoice_payment_proofs di bawah, sama pola dengan material_claim_photos (migration 0014),
-- supaya tidak ikut ke-refetch oleh setiap user di setiap refresh snapshot. Byte PDF baru
-- diambil sesuai permintaan lewat Server Action khusus (getInvoicePaymentProofAction) saat
-- Finance/Procurement klik "Lihat bukti".
--
-- PENTING: invoice_payment_proofs SENGAJA TIDAK ditambahkan ke get_flow_snapshot_raw()
-- (migration 0008/0012) -- get_flow_snapshot_raw memakai to_jsonb(t) per tabel, jadi kolom
-- baru di raw_material_invoices ikut otomatis, tapi TABEL baru tidak -- kalau suatu saat
-- menambah tabel baru lain ke snapshot, jangan ikut tabel ini.
alter table raw_material_invoices add column if not exists bukti_bayar_at timestamptz;
alter table raw_material_invoices add column if not exists bukti_bayar_file_name text;

create table if not exists invoice_payment_proofs (
  invoice_id text primary key,
  data_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);
