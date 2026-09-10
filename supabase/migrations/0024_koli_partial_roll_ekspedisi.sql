-- Feedback 2026-09-10 (owner, setelah redesain Finish Good "Isi qty per size" -- item 15): owner
-- minta pola INPUT yang sama dipakai lagi di Pengiriman > "Buat koli baru" -- ketik qty per
-- (warna·lengan·size), qty itu mengurangi sisa yang tersedia di roll manapun yang cocok.
-- Dikonfirmasi lewat AskUserQuestion: ini BERARTI 1 roll BOLEH dikirim SEBAGIAN (sisanya tetap
-- tersedia untuk koli lain nanti) -- mengubah keputusan desain migration 0020
-- ("1 roll SELALU dikirim UTUH", delivery_koli_batches UNIQUE(production_batch_id)) yang sengaja
-- dibuat untuk penelusuran HPP per roll.
--
-- Ganti mekanismenya: bukan lagi 1 baris "roll X masuk koli Y" di level KOLI
-- (delivery_koli_batches), tapi link PER ITEM (delivery_koli_items.source_batch_id) di granularitas
-- SIZE yang sama dengan qty item itu sendiri -- ini yang memungkinkan 1 roll nyebar ke banyak koli,
-- karena tiap item independen menyimpan roll asalnya sendiri.
--
-- delivery_koli_batches TIDAK dihapus -- tetap dibaca sebagai FALLBACK untuk koli lama (dibuat
-- sebelum migration ini) yang datanya cuma ada di situ (item-nya belum punya source_batch_id),
-- pola sama seperti fallback pool lama yang sudah berulang kali dipakai di HPP (lihat derive.ts).
alter table delivery_koli_items add column if not exists source_batch_id text references production_batches(id);

-- Buang constraint yang jadi penghalang schema-level untuk shipment sebagian. Nama constraint ini
-- hasil auto-generate Postgres dari `unique (production_batch_id)` inline di migration 0020 --
-- kalau nama sebenarnya beda di database live, jalankan `\d delivery_koli_batches` dulu untuk
-- konfirmasi nama persisnya sebelum re-run migration ini.
alter table delivery_koli_batches drop constraint if exists delivery_koli_batches_production_batch_id_key;

-- Item feedback yang sama: "Saat pilih ekspedisi juga nanti akan ada input gambar lampiran (note
-- dari ekspedisi) sebelum melakukan proses penerbitan invoice & payment" -- keterangan + foto
-- WAJIB begitu ekspedisi dipilih (lihat setKoliEkspedisiAction, actions.ts). Ini SATU aksi atomik
-- dengan pengisian `ekspedisi` sendiri -- jadi gate "Delivery" yang SUDAH ADA
-- (disabled={!(berat>0 && k.ekspedisi)}) otomatis juga menjamin catatan+foto sudah ada, tanpa perlu
-- gate baru di jalur invoice sama sekali.
alter table delivery_kolis add column if not exists ekspedisi_note text;
alter table delivery_kolis add column if not exists ekspedisi_note_at timestamptz;

-- Foto TIDAK ikut snapshot (pola sama persis material_claim_photos, migration 0014) -- payload
-- data URI base64 bisa ratusan KB, jadi disimpan terpisah & diambil on-demand lewat Server Action
-- (getDeliveryKoliEkspedisiPhotoAction) saat user klik "Lihat / Download", bukan ikut ke-refetch
-- oleh setiap user di setiap refresh snapshot.
create table if not exists delivery_koli_ekspedisi_photos (
  delivery_koli_id text primary key references delivery_kolis(id) on delete cascade,
  data_url text not null,
  file_name text,
  uploaded_at timestamptz not null default now()
);

-- `ongkir_batch` (delivery_kolis, migration 0020) SENGAJA TIDAK di-drop -- owner minta field
-- override manual ini dihapus dari APLIKASI (ongkir sekarang SELALU otomatis dari tarif ekspedisi x
-- berat koli, lihat ekspedisiPrice di lib/mrp/derive.ts), bukan dari database -- kolomnya dibiarkan
-- ada (jadi orphan tidak terpakai) konsisten dengan pola migration lain di proyek ini yang
-- additive-only, tidak pernah menghapus kolom yang sudah ada.
