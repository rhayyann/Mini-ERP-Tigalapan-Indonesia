-- Item 2/3 (feedback batch 2026-09-04): Procurement bisa lihat/download foto bukti berat bersih
-- yang diupload vendor saat mengajukan klaim selisih berat (production-cutting-tab.tsx).
--
-- `claim_photo_at` di raw_material_invoice_rolls/material_claim_history cuma FLAG murah (ada foto
-- atau tidak) yang ikut snapshot biasa -- payload foto sendiri (data URI base64, bisa ratusan KB)
-- sengaja DIPISAH ke tabel material_claim_photos di bawah supaya tidak ikut ke-refetch oleh setiap
-- user di setiap refresh snapshot. Byte foto baru diambil sesuai permintaan lewat Server Action
-- khusus (getMaterialClaimPhotoAction) saat user klik "Lihat / Download".
--
-- PENTING: material_claim_photos SENGAJA TIDAK ditambahkan ke get_flow_snapshot_raw() (migration
-- 0008/0012) -- kalau suatu saat menambah tabel baru lain ke snapshot, jangan ikut tabel ini.
alter table raw_material_invoice_rolls add column if not exists claim_photo_at timestamptz;
alter table material_claim_history add column if not exists claim_photo_at timestamptz;

create table if not exists material_claim_photos (
  claim_key text primary key, -- invoiceId|warna|lengan|rollIndex (sama seperti key di materialClaimsList)
  invoice_id text not null,
  warna text not null,
  lengan text not null,
  roll_index int not null,
  data_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);
