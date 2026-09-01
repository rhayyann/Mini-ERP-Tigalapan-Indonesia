-- mini-erp-garmen: initial schema
-- Semua tabel dipakai HANYA lewat Supabase service role dari Next.js Server Actions
-- (lihat lib/supabase/server.ts). RLS diaktifkan di semua tabel TANPA policy sebagai
-- jaring pengaman kedua -- service role bypass RLS by design, jadi ini murni proteksi
-- kalau anon key suatu saat dipakai langsung dari client.

-- =========================================================================
-- ENUMS
-- =========================================================================
create type lengan_t as enum ('PENDEK', 'PANJANG');
create type usia_t as enum ('KIDS', 'DEWASA');
create type ppic_approval_t as enum ('DRAFT', 'WAITING_PPIC_APPROVAL', 'PPIC_APPROVED', 'REJECTED');
create type material_po_status_t as enum ('WAITING_INVOICE', 'INVOICE', 'PAYMENT', 'DELIVERY_MATERIAL', 'PROSES_PRODUKSI', 'CANCELLED');
create type maklon_po_status_t as enum ('FULL_WAITING_MATERIAL', 'PARTIAL_WAITING_MATERIAL', 'PRODUCTION', 'PARTIAL_PRODUCTION', 'DELIVERY', 'INVOICE', 'PAID', 'FULLY_PAID');
create type invoice_status_t as enum ('WAITING_INVOICE', 'INVOICED', 'PAID', 'DELIVERY', 'RECEIVING', 'WAITING_PRODUCTION', 'PRODUCTION_DONE');
create type maklon_invoice_status_t as enum ('SUBMITTED', 'APPROVED', 'PAID');
create type production_kind_t as enum ('FG', 'REJECT');
create type delivery_item_kind_t as enum ('FG', 'REJECT', 'REWORK');
create type vendor_invoice_status_t as enum ('SUBMITTED', 'REVISION', 'APPROVED', 'PAID');
create type vendor_invoice_adjustment_kind_t as enum ('DENDA', 'REWARD', 'TIDAK_ADA');
create type jenis_harga_t as enum ('Standar', 'PKS');

-- =========================================================================
-- MASTER / REFERENCE DATA
-- =========================================================================
create table entitas (
  id text primary key,
  nama text not null
);

create table suppliers (
  id text primary key,
  nama text not null
);

create table vendors_produksi (
  id text primary key, -- kode vendor, mis. "CE", "GI-01"
  name text not null,
  base_capacity integer not null default 0,
  rate_per_pc numeric not null default 0,
  est_days integer not null default 0,
  retention_pct numeric not null default 0,
  production_lead_days integer not null default 0,
  password_hash text not null
);

create table harga_maklon (
  id text primary key,
  kode_vendor text not null,
  nama_vendor text not null,
  tipe_lengan text not null,
  jenis_harga jenis_harga_t not null,
  kapasitas_min integer,
  kapasitas_max integer,
  harga numeric not null
);

create table harga_kain (
  id text primary key,
  kode_supplier text not null,
  nama_supplier text not null,
  kategori text not null,
  warna text not null,
  harga_per_kg numeric not null
);

create table harga_kain_pks (
  id text primary key,
  kode_supplier text not null,
  kategori text not null,
  warna text not null,
  satuan text not null,
  tonase_min numeric,
  tonase_max numeric,
  harga_per_kg numeric not null
);

-- =========================================================================
-- MRP CORE
-- =========================================================================
create table mrp (
  id text primary key,
  kategori text not null,
  warna text not null,
  target_date date not null,
  live boolean not null default true,
  qty integer not null default 0,
  is_fob boolean not null default false,
  ppic_approval ppic_approval_t not null default 'DRAFT',
  ppic_rejection_note text,
  po_sent boolean not null default false,
  created_at timestamptz not null default now(),
  ppic_submitted_at timestamptz,
  ppic_approved_at timestamptz,
  po_sent_at timestamptz,
  po_approved_at timestamptz,
  first_invoice_at timestamptz,
  first_payment_at timestamptz
);

create table lengan_groups (
  id text primary key,
  mrp_id text not null references mrp(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  total_qty integer not null default 0,
  rib_kg numeric not null default 0,
  roll_estimate numeric not null default 0,
  vendor_default text
);
create index on lengan_groups(mrp_id);

create table lengan_group_sizes (
  id bigint generated always as identity primary key,
  lengan_group_id text not null references lengan_groups(id) on delete cascade,
  size text not null,
  qty integer not null default 0
);
create index on lengan_group_sizes(lengan_group_id);

create table aduan_pola_rows (
  id text primary key,
  lengan_group_id text not null references lengan_groups(id) on delete cascade,
  mrp_id text not null references mrp(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  kode text not null,
  qty_roll numeric not null default 0,
  qty integer not null default 0,
  vendor text not null,
  rib_allocated_roll numeric
);
create index on aduan_pola_rows(mrp_id);
create index on aduan_pola_rows(lengan_group_id);

create table aduan_pola_sizes (
  id bigint generated always as identity primary key,
  aduan_row_id text not null references aduan_pola_rows(id) on delete cascade,
  size text not null,
  qty integer not null default 0
);
create index on aduan_pola_sizes(aduan_row_id);

create table material_rows (
  id text primary key,
  lengan_group_id text not null references lengan_groups(id) on delete cascade,
  mrp_id text not null references mrp(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  qty_roll numeric not null default 0,
  rib_kg numeric not null default 0,
  supplier text,
  entitas text
);
create index on material_rows(mrp_id);

-- =========================================================================
-- MATERIAL PO
-- =========================================================================
create table material_pos (
  id text primary key,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  supplier text not null,
  warna text not null,
  lengan lengan_t not null,
  roll_count numeric not null default 0,
  available_rolls numeric not null default 0,
  invoiced_rolls numeric not null default 0,
  amount numeric not null default 0,
  entity text,
  status material_po_status_t not null default 'WAITING_INVOICE',
  approved boolean not null default false,
  days_since_po integer not null default 0,
  created_at timestamptz not null default now()
);
create index on material_pos(mrp_id);
create index on material_pos(vendor_produksi);

create table material_po_color_breakdown (
  id bigint generated always as identity primary key,
  material_po_id text not null references material_pos(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  roll_count numeric not null default 0,
  entitas text
);
create index on material_po_color_breakdown(material_po_id);

create table material_po_invoiced_by_color (
  material_po_id text not null references material_pos(id) on delete cascade,
  color_key text not null,
  invoiced_rolls numeric not null default 0,
  primary key (material_po_id, color_key)
);

-- =========================================================================
-- MAKLON PO
-- =========================================================================
create table maklon_pos (
  id text primary key,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  qty integer not null default 0,
  amount numeric not null default 0,
  entity text,
  status maklon_po_status_t not null default 'FULL_WAITING_MATERIAL',
  approved boolean not null default false,
  reject_remark text
);
create index on maklon_pos(mrp_id);
create index on maklon_pos(vendor_produksi);

create table maklon_po_cancelled_lines (
  id bigint generated always as identity primary key,
  maklon_po_id text not null references maklon_pos(id) on delete cascade,
  note text not null,
  rolls numeric not null default 0,
  warna text,
  lengan lengan_t,
  pcs integer,
  from_vendor text,
  time timestamptz not null default now()
);
create index on maklon_po_cancelled_lines(maklon_po_id);

-- =========================================================================
-- RAW MATERIAL INVOICE
-- =========================================================================
create table raw_material_invoices (
  id text primary key,
  po_id text not null references material_pos(id) on delete cascade,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  supplier text not null,
  qty_ready numeric not null default 0,
  diskon numeric not null default 0,
  total_biaya numeric not null default 0,
  kode_transaksi text,
  no_invoice_vendor text,
  entity text,
  status invoice_status_t not null default 'WAITING_INVOICE',
  destination_vendor text,
  booked_at timestamptz not null default now(),
  bukti_pv_storage_path text,
  bukti_pv_file_name text,
  paid_at timestamptz,
  delivered_at timestamptz,
  received_at timestamptz,
  production_start timestamptz,
  production_end timestamptz
);
create index on raw_material_invoices(po_id);
create index on raw_material_invoices(mrp_id);

create table raw_material_invoice_colors (
  id text primary key,
  invoice_id text not null references raw_material_invoices(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  harga_per_roll numeric not null default 0
);
create index on raw_material_invoice_colors(invoice_id);

create table raw_material_invoice_rolls (
  id bigint generated always as identity primary key,
  invoice_color_id text not null references raw_material_invoice_colors(id) on delete cascade,
  roll_index integer not null,
  gross_kg numeric not null default 0,
  net_kg numeric,
  received_at timestamptz,
  code_roll text,
  code_lot text,
  claim_resolved_note text,
  claim_resolved_at timestamptz,
  claim_retur_note text,
  claim_retur_requested_at timestamptz,
  unique (invoice_color_id, roll_index)
);
create index on raw_material_invoice_rolls(invoice_color_id);

create table raw_material_invoice_addbuys (
  id text primary key,
  invoice_id text not null references raw_material_invoices(id) on delete cascade,
  item text not null,
  warna text,
  berat_kg numeric not null default 0,
  harga_per_kg numeric,
  total_harga numeric not null default 0,
  remark text,
  received_at timestamptz
);
create index on raw_material_invoice_addbuys(invoice_id);

-- =========================================================================
-- MAKLON INVOICE (legacy path, tetap disimpan untuk data lama)
-- =========================================================================
create table maklon_invoices (
  id text primary key,
  maklon_po_id text not null references maklon_pos(id) on delete cascade,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  base_fee numeric not null default 0,
  penalty numeric not null default 0,
  bonus numeric not null default 0,
  retention_pct numeric not null default 0,
  net_amount numeric not null default 0,
  entity text,
  status maklon_invoice_status_t not null default 'SUBMITTED',
  note text,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz
);
create index on maklon_invoices(maklon_po_id);
create index on maklon_invoices(mrp_id);

-- =========================================================================
-- PRODUKSI
-- =========================================================================
create table production_batches (
  id text primary key,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  aduan_row_id text not null references aduan_pola_rows(id) on delete cascade,
  kode text,
  warna text not null,
  lengan lengan_t not null,
  qty_roll numeric not null default 0,
  gramasi numeric,
  resting_at timestamptz,
  cutting_at timestamptz,
  created_at timestamptz not null default now(),
  code_roll text
);
create index on production_batches(mrp_id);
create index on production_batches(aduan_row_id);

create table production_results (
  id text primary key,
  group_key text not null,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  po_id text not null references maklon_pos(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  kind production_kind_t not null,
  recorded_at timestamptz not null default now(),
  note text,
  usia usia_t
);
create index on production_results(group_key);
create index on production_results(mrp_id);
create index on production_results(po_id);

create table production_result_sizes (
  id bigint generated always as identity primary key,
  production_result_id text not null references production_results(id) on delete cascade,
  size text not null,
  qty integer not null default 0
);
create index on production_result_sizes(production_result_id);

create table production_group_meta (
  group_key text primary key,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  warna text not null,
  lengan lengan_t not null,
  done_at timestamptz,
  remark_sisa_reject text
);
create index on production_group_meta(mrp_id);

-- =========================================================================
-- DELIVERY
-- =========================================================================
create table delivery_kolis (
  id text primary key,
  mrp_id text not null references mrp(id) on delete cascade,
  vendor_produksi text not null references vendors_produksi(id),
  ekspedisi text,
  no_koli text,
  berat_koli numeric,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index on delivery_kolis(mrp_id);
create index on delivery_kolis(vendor_produksi);

create table delivery_koli_items (
  id bigint generated always as identity primary key,
  delivery_koli_id text not null references delivery_kolis(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  size text not null,
  qty integer not null default 0,
  kind delivery_item_kind_t not null,
  usia usia_t
);
create index on delivery_koli_items(delivery_koli_id);

-- =========================================================================
-- VENDOR INVOICE (jalur billing aktif)
-- =========================================================================
create table vendor_invoices (
  id text primary key,
  vendor_produksi text not null references vendors_produksi(id),
  total_tagihan numeric not null default 0,
  net_tagihan numeric not null default 0,
  status vendor_invoice_status_t not null default 'SUBMITTED',
  note text,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  due_date date,
  ongkir_total numeric
);
create index on vendor_invoices(vendor_produksi);

create table vendor_invoice_lines (
  id bigint generated always as identity primary key,
  vendor_invoice_id text not null references vendor_invoices(id) on delete cascade,
  mrp_id text not null references mrp(id) on delete cascade,
  warna text not null,
  lengan lengan_t not null,
  usia usia_t,
  qty integer not null default 0,
  rate_per_pc numeric not null default 0,
  amount numeric not null default 0
);
create index on vendor_invoice_lines(vendor_invoice_id);
create index on vendor_invoice_lines(mrp_id);

create table vendor_invoice_adjustments (
  id text primary key,
  vendor_invoice_id text not null references vendor_invoices(id) on delete cascade,
  kind vendor_invoice_adjustment_kind_t not null,
  label text not null,
  amount numeric not null default 0,
  note text,
  added_at timestamptz not null default now()
);
create index on vendor_invoice_adjustments(vendor_invoice_id);

-- =========================================================================
-- NOTIFIKASI
-- =========================================================================
create table notifications (
  id text primary key,
  text text not null,
  time timestamptz not null default now(),
  audience text[] not null default '{}',
  vendor_id text references vendors_produksi(id),
  read boolean not null default false
);
create index on notifications using gin (audience);
create index on notifications(vendor_id);

-- =========================================================================
-- RLS: aktifkan di semua tabel, TANPA policy (default deny untuk anon/authenticated).
-- Service role (dipakai server-side lewat Server Actions) selalu bypass RLS.
-- =========================================================================
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
