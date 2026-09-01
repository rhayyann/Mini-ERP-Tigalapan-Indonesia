"use client";

import { useMrpStore } from "@/lib/mrp/store";

export function ResetDataButton({ variant = "button" }: { variant?: "button" | "menu-item" }) {
  const resetAll = useMrpStore((s) => s.resetAll);

  function handleReset() {
    resetAll();
    try {
      localStorage.removeItem("g2g-sim-v1");
    } catch {}
    // Reload halaman yang sama (bukan redirect ke rute tetap) supaya tetap konsisten
    // di role/halaman manapun tombol ini dipakai — sesi login tidak ikut ter-reset.
    window.location.reload();
  }

  if (variant === "menu-item") {
    return (
      <button
        onClick={handleReset}
        title="Hapus semua data dan kembali ke kondisi kosong (fresh start)"
        className="block w-full px-3.5 py-2 text-left font-sans text-xs font-medium text-text-muted hover:bg-[#F7F9FB] hover:text-danger-fg"
      >
        Reset data
      </button>
    );
  }

  return (
    <button
      onClick={handleReset}
      title="Hapus semua data dan kembali ke kondisi kosong (fresh start)"
      className="rounded-[5px] border border-border-subtle px-[10px] py-[5px] font-sans text-xs font-medium text-text-muted hover:text-danger-fg"
    >
      Reset data
    </button>
  );
}
