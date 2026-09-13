import "server-only";
import { supabaseServer } from "../../supabase/server";

/** ID "manusiawi" (mis. "MRP-101") lewat fungsi Postgres next_readable_id() (lihat
 *  supabase/migrations/0003_id_sequence.sql) -- gantikan nextId() in-memory yang lama. */
export async function nextReadableId(prefix: string): Promise<string> {
  const { data, error } = await supabaseServer().rpc("next_readable_id", { p_prefix: prefix });
  if (error || !data) throw new Error(`Gagal generate ID (${prefix}): ${error?.message ?? "unknown error"}`);
  return data as string;
}

/** Bersihkan 1 segmen ID PO (kode vendor, nama supplier, nama entitas) supaya aman dipakai di
 *  primary key -- uppercase, spasi/simbol jadi "-", rapikan tanda hubung ganda/di ujung.
 *  CATATAN (reviewer 2026-09-13): 2 nama supplier yang BEDA tapi kebetulan sanitized-nya SAMA
 *  (mis. "Supplier A" vs "Supplier A!!!" -> sama-sama "SUPPLIER-A") tetap aman secara DATA --
 *  suffix anti-tabrakan di nextPoDisplayId (-2, -3, dst) tetap membuat ID keduanya beda. Yang
 *  bisa membingungkan cuma LABELNYA (kelihatan seperti "supplier sama dipakai 2x" padahal 2
 *  supplier beda) -- murni kosmetik, bukan bug integritas data. */
function sanitizeIdSegment(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** ID deskriptif untuk PO Maklon/Material (BEDA dari nextReadableId yang generik) -- format
 *  `{prefix}-{mrpId}-{segmen1}-{segmen2}-...` (segmen SUDAH disanitasi pemanggil). Kalau kombinasi
 *  itu sudah dipakai (mis. reassign ke supplier yang sebelumnya sudah pernah dipakai untuk
 *  mrp+vendor yang sama), ditambah akhiran "-2", "-3", dst sampai ketemu yang belum dipakai --
 *  supaya TETAP DETERMINISTIK & terbaca (bukan random), tapi TIDAK PERNAH tabrakan primary key.
 *  `table` = "maklon_pos" | "material_pos" (tabel yang id-nya mau dicek). */
export async function nextPoDisplayId(table: "maklon_pos" | "material_pos", prefix: "PO-MKL" | "PO-SUP", segments: string[]): Promise<string> {
  const db = supabaseServer();
  const base = [prefix, ...segments.map(sanitizeIdSegment)].join("-");
  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await db.from(table).select("id").eq("id", candidate).maybeSingle();
    if (error) throw new Error(`Gagal generate ID PO (${candidate}): ${error.message}`);
    if (!data) return candidate;
    candidate = `${base}-${n}`;
    n++;
  }
}
