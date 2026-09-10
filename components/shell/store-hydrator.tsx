"use client";

import { useEffect, useRef } from "react";
import { useMrpStore } from "@/lib/mrp/store";

// Refetch snapshot penuh (~30 tabel) paling sering tiap ini banyak detik -- mencegah beberapa
// pemicu (mount, focus, interval) numpuk jadi fetch beruntun kalau kebetulan berdekatan waktunya.
const MIN_REFETCH_INTERVAL_MS = 5_000;
// Poll berkala supaya perubahan dari user/tab LAIN tetap kelihatan tanpa aksi apa pun dari user
// ini -- lebih jarang dari dulu (dulu: setiap klik pindah halaman) supaya navigasi terasa instan.
const POLL_INTERVAL_MS = 30_000;

/** Mount sekali di root layout (lihat app/layout.tsx). Mengisi useMrpStore dari Supabase lewat
 *  getFlowSnapshotAction (Server Action), menggantikan zustand `persist`/localStorage yang lama.
 *
 *  CATATAN PERFORMA (revisi setelah testing): versi awal refetch di SETIAP perpindahan halaman
 *  (pathname berubah) -- snapshot penuh (~30 tabel) makan waktu ratusan ms - beberapa detik,
 *  jadi tiap klik navigasi terasa lambat. Sekarang cuma fetch: (1) sekali saat mount, (2) saat
 *  tab kembali fokus (alt-tab balik / pindah tab balik), (3) polling ringan tiap 30 detik selagi
 *  tab kelihatan -- supaya perubahan dari user/tab LAIN tetap muncul tanpa bikin SETIAP klik
 *  navigasi menunggu roundtrip Supabase. Aksi milik user sendiri (lib/mrp/store.ts, tiap action
 *  memanggil refresh() setelah sukses) TETAP langsung ter-refresh seketika, tidak menunggu poll.
 *
 *  Di halaman publik (mis. "/" atau "/vendor-maklon/login") belum tentu ada sesi login -- error
 *  "Unauthorized" dari getFlowSnapshotAction di situ SENGAJA ditelan diam-diam, bukan bug. */
export function StoreHydrator() {
  // Fix (feedback batch 2026-09-10, item 6/10 "tombol ngeflick"): dulu fetch di sini LANGSUNG
  // manggil getFlowSnapshotAction() + hydrate() (set() mentah) -- sama sekali di luar guard
  // `inFlightWriteCount` yang dipakai jalur backgroundRefresh (lib/mrp/store.ts) untuk mencegah
  // snapshot "separuh jalan" menimpa balik patch optimistic action yang masih berjalan. Sekarang
  // pakai refresh() milik store -- SUDAH menunggu semua tulisan yang sedang berlangsung selesai
  // dulu (lihat catatan panjang di refresh(), lib/mrp/store.ts), jadi trigger di sini (mount,
  // focus, visibilitychange, poll 30 detik) aman dipanggil kapan saja tanpa risiko flicker.
  const refresh = useMrpStore((s) => s.refresh);
  const lastFetchAt = useRef(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    // Fix (feedback batch 2026-09-10): `cancelled` guard yang dulu ada di sini cuma menjaga
    // supaya hydrate(snapshot) (set() mentah) tidak dipanggil setelah unmount -- sekarang
    // refresh() itu sendiri yang melakukan fetch+set (lihat lib/mrp/store.ts), jadi tidak ada lagi
    // snapshot lokal yang perlu dijaga di sini; refresh() aman dipanggil dari effect manapun.
    function fetchNow(force = false) {
      const now = Date.now();
      if (!force && now - lastFetchAt.current < MIN_REFETCH_INTERVAL_MS) return;
      lastFetchAt.current = now;
      refreshRef.current().catch(() => {
        // Belum login / sesi kedaluwarsa di halaman ini -- biarkan store tetap kosong.
      });
    }

    fetchNow(true);
    const onFocus = () => fetchNow();
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchNow();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchNow();
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, []);

  return null;
}
