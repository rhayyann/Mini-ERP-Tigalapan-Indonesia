-- Generator ID "manusiawi" (mis. "MRP-101", "PO-102") menggantikan counter in-memory
-- `nextId()` yang dulu ada di lib/mrp/store.ts (counter tunggal dibagi semua jenis
-- entitas, di-bump ulang tiap rehydrate localStorage lewat bumpCounterPast -- pola itu
-- sekarang tidak relevan lagi karena Postgres jadi satu-satunya sumber kebenaran).
-- Satu sequence global dipakai lintas semua prefix, PERSIS meniru perilaku lama.
create sequence if not exists global_id_seq start 1;

create or replace function next_readable_id(p_prefix text)
returns text
language sql
as $$
  select p_prefix || '-' || (100 + nextval('global_id_seq'));
$$;
