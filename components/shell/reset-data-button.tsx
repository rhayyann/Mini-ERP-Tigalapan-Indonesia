"use client";

import { useMrpStore } from "@/lib/mrp/store";

export function ResetDataButton({ variant = "button" }: { variant?: "button" | "menu-item" }) {
  const resetAll = useMrpStore((s) => s.resetAll);

  async function handleReset() {
    // CATATAN MIGRASI: ini sekarang benar-benar menghapus data BERSAMA di Supabase (semua modul
    // & vendor), bukan cuma localStorage browser sendiri seperti dulu -- confirm dulu di sini
    // sebelum action dipanggil, supaya tidak ada klik-tak-sengaja yang menghapus data semua orang.
    const ok = window.confirm(
      "Yakin hapus SEMUA data? Ini akan menghapus data MRP, PO, invoice, produksi, delivery, dan master data milik SEMUA modul & vendor (bukan cuma punya Anda). Aksi ini tidak bisa dibatalkan."
    );
    if (!ok) return;
    // BUG FIX 2026-09-11 (owner: "kenapa fitur reset data tidak bisa bekerja?"): dulu tidak ada
    // try/catch di sini -- kalau resetAll() gagal (mis. sesi kedaluwarsa di tengah pemakaian, atau
    // error Supabase lain), `await` di bawah cuma reject diam-diam (unhandled rejection), function
    // berhenti SEBELUM sempat localStorage.removeItem/reload -- dari sisi user: klik tombol,
    // dialog konfirmasi hilang, lalu TIDAK TERJADI APA-APA, tidak ada pesan error sama sekali.
    // Sekarang gagalnya dikasih tahu eksplisit (sesi kedaluwarsa sendiri sudah dikasih alert
    // terpisah oleh guardAction, lib/mrp/store.ts -- ini jaring pengaman untuk error LAIN di luar
    // itu, supaya tidak pernah lagi terlihat seperti "tombolnya tidak bekerja").
    try {
      await resetAll();
    } catch (err) {
      window.alert(`Reset data gagal: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
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
