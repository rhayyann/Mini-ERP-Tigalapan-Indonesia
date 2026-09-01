import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase khusus server, pakai Service Role Key (bypass RLS).
 *
 * SENGAJA tidak pernah diimpor dari komponen "use client" -- import "server-only" di
 * atas bikin build gagal kalau ada file client yang tidak sengaja mengimpor ini,
 * supaya SUPABASE_SERVICE_ROLE_KEY tidak pernah ikut ke bundle browser.
 *
 * Semua akses ke Supabase di app ini lewat client ini (dipanggil dari Server Action /
 * Route Handler), TIDAK ada client-side Supabase call sama sekali -- lihat catatan
 * arsitektur di plan migrasi (.claude/plans, atau ringkasannya di README).
 */
let cached: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase belum dikonfigurasi: pastikan NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY ada di .env.local (server) / env var Vercel."
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
