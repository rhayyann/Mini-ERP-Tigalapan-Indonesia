import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { InternalRole } from "../internal-auth";

// CATATAN DESAIN (revisi setelah testing lintas-modul): DULU ada SATU cookie sesi untuk
// internal+vendor sekaligus, isinya cuma SATU role/vendor -- akibatnya login ke modul lain (atau
// ke Vendor Produksi) di tab lain diam-diam MENIMPA/menghapus sesi modul yang sedang aktif di tab
// sebelumnya (karena satu browser = satu cookie jar, dibagi semua tab). Sekarang dipecah:
//   - Cookie internal (`erp_internal_session`) isinya ARRAY role yang lagi aktif (mis. bisa PPIC
//     DAN Finance login bersamaan di tab berbeda, sama seperti `unlockedRoles[]` di app lama yang
//     berbasis localStorage) -- login role baru MENAMBAH ke array ini, bukan mengganti.
//   - Cookie vendor (`erp_vendor_session`) TERPISAH TOTAL dari cookie internal -- login/logout
//     vendor tidak lagi menyentuh sesi role internal manapun, dan sebaliknya.
// Beda browser/device (pengguna berbeda sungguhan) SUDAH otomatis punya cookie jar sendiri-sendiri
// dari dulu -- pemisahan ini murni untuk kasus SATU browser dipakai gonta-ganti banyak
// role/vendor sekaligus (skenario testing).
export const INTERNAL_SESSION_COOKIE = "erp_internal_session";
export const VENDOR_SESSION_COOKIE = "erp_vendor_session";

// 30 hari -- jauh lebih longgar dari kebutuhan kerja normal manapun (praktis "tanpa batas" untuk
// pemakaian sehari-hari), tapi tetap ada masa berlaku (bukan token abadi) sebagai jaring pengaman
// keamanan standar. Digabung dengan fix cross-tab di atas, sesi seharusnya nyaris tidak pernah
// terasa "habis sendiri" lagi selama dipakai wajar.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type Session = { internalRoles: InternalRole[]; vendorId: string | null };

/** Interface minimal yang dipenuhi baik `next/headers` cookies() (Server Action/Component)
 *  MAUPUN `NextRequest.cookies` (proxy.ts) -- supaya readSession() bisa dipakai dari keduanya. */
type ReadableCookies = { get(name: string): { value: string } | undefined };

function secretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum di-set (lihat .env.local / env var Vercel).");
  return new TextEncoder().encode(secret);
}

async function signToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${SESSION_TTL_SECONDS}s`).sign(secretKey());
}

export async function createInternalSessionToken(roles: InternalRole[]): Promise<string> {
  return signToken({ kind: "internal", roles });
}

export async function createVendorSessionToken(vendorId: string): Promise<string> {
  return signToken({ kind: "vendor", vendorId });
}

async function verifyInternalToken(token: string | undefined): Promise<InternalRole[]> {
  if (!token) return [];
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.kind === "internal" && Array.isArray(payload.roles)) {
      return (payload.roles as unknown[]).filter((r): r is InternalRole => typeof r === "string");
    }
    return [];
  } catch {
    return [];
  }
}

async function verifyVendorToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.kind === "vendor" && typeof payload.vendorId === "string") return payload.vendorId;
    return null;
  } catch {
    return null;
  }
}

/** Baca kedua cookie sesi (internal + vendor) sekaligus jadi satu objek Session. Dipakai dari
 *  proxy.ts (lewat NextRequest.cookies) DAN dari requireSession() di bawah (lewat next/headers
 *  cookies()) -- satu sumber kebenaran untuk cara membaca sesi, tidak duplikat logic. */
export async function readSession(cookieStore: ReadableCookies): Promise<Session> {
  const [internalRoles, vendorId] = await Promise.all([
    verifyInternalToken(cookieStore.get(INTERNAL_SESSION_COOKIE)?.value),
    verifyVendorToken(cookieStore.get(VENDOR_SESSION_COOKIE)?.value),
  ]);
  return { internalRoles, vendorId };
}

/** Dipakai dari DALAM setiap Server Action yang memutasi data (lib/mrp/actions.ts, dst.) --
 *  proxy.ts TIDAK bisa dijadikan satu-satunya lapisan proteksi buat Server Function (lihat
 *  catatan di proxy.ts & docs Next.js: guides/server-actions.md#security), jadi tiap action
 *  wajib panggil ini sendiri di baris pertama sebelum menyentuh Supabase. */
export async function requireSession(): Promise<Session> {
  const { cookies } = await import("next/headers");
  const session = await readSession(await cookies());
  if (session.internalRoles.length === 0 && !session.vendorId) {
    throw new Error("Unauthorized: sesi login tidak valid atau kedaluwarsa.");
  }
  return session;
}

export function requireInternalRole(session: Session, role: InternalRole): void {
  if (!session.internalRoles.includes(role)) {
    throw new Error(`Forbidden: aksi ini hanya untuk modul ${role}.`);
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
