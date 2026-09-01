"use client";

import { useMrpStore } from "@/lib/mrp/store";

/** Overlay penuh layar yang muncul selama ADA action lib/mrp/store.ts yang berjalan (lihat
 *  withBusyTracking) -- nge-blok klik lain sampai selesai supaya user tidak klik berulang kali
 *  (mis. dobel klik "Reset data" / "Approve") selagi request masih diproses server. Mount sekali
 *  di root layout (lihat app/layout.tsx), otomatis berlaku di semua halaman yang pakai useMrpStore
 *  tanpa perlu diubah satu-satu. */
export function BusyOverlay() {
  const busy = useMrpStore((s) => s.busy);
  if (!busy) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/15 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 rounded-lg bg-surface-card px-5 py-3.5 shadow-[0_12px_32px_rgba(0,0,0,.28)]">
        <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-action-primary border-t-transparent" />
        <span className="font-sans text-[13px] font-medium text-text-primary">Memproses...</span>
      </div>
    </div>
  );
}
