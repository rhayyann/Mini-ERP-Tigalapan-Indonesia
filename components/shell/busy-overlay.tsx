"use client";

import { useMrpStore } from "@/lib/mrp/store";

/** Lapisan pemblokir klik tak-terlihat selama ADA action lib/mrp/store.ts yang berjalan (lihat
 *  withBusyTracking) -- nge-blok klik lain sampai selesai supaya user tidak klik berulang kali
 *  (mis. dobel klik "Approve"/"Bayar") selagi request masih diproses server. Mount sekali di root
 *  layout (lihat app/layout.tsx), otomatis berlaku di semua halaman yang pakai useMrpStore tanpa
 *  perlu diubah satu-satu.
 *
 *  DULU ini nampilkan overlay penuh layar (spinner + teks "Memproses..."). Atas permintaan owner
 *  (2026-09-05): semua aksi create-data harus TERASA instan -- data yang berubah cukup tampil
 *  begitu selesai (lewat backgroundRefresh di store.ts, biasanya <1 detik), TANPA ada indikator
 *  loading yang terlihat user. Jadi sekarang render-nya TETAP ADA (fungsinya tetap sama persis:
 *  blok pointer-events layar penuh selama `busy`) tapi 100% transparan -- tidak ada kotak, spinner,
 *  ataupun teks yang terlihat. `aria-live`/sr-only text dipertahankan supaya pengguna screen
 *  reader tetap dapat info "sedang diproses" walau tidak ada apapun yang terlihat di layar. */
export function BusyOverlay() {
  const busy = useMrpStore((s) => s.busy);
  if (!busy) return null;

  return (
    <div className="fixed inset-0 z-[9999]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Memproses...</span>
    </div>
  );
}
