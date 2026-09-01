import "server-only";
import { supabaseServer } from "../../supabase/server";

/** ID "manusiawi" (mis. "MRP-101") lewat fungsi Postgres next_readable_id() (lihat
 *  supabase/migrations/0003_id_sequence.sql) -- gantikan nextId() in-memory yang lama. */
export async function nextReadableId(prefix: string): Promise<string> {
  const { data, error } = await supabaseServer().rpc("next_readable_id", { p_prefix: prefix });
  if (error || !data) throw new Error(`Gagal generate ID (${prefix}): ${error?.message ?? "unknown error"}`);
  return data as string;
}
