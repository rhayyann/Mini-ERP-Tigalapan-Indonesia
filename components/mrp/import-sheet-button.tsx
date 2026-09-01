"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Tombol "Import dari Google Sheets" reusable — dipakai di semua panel Master Data. Menangani
 *  state loading/error/sukses sendiri supaya tiap panel tidak perlu duplikasi logic ini.
 *  `onImport` melakukan fetch+parse+replace ke store, dan mengembalikan jumlah baris yang masuk
 *  (untuk pesan konfirmasi) atau melempar Error (pesan Indonesia) kalau gagal.
 *
 *  `autoImportIfEmpty`: kalau true SAAT KOMPONEN PERTAMA KALI DIRENDER, import otomatis jalan
 *  sekali tanpa perlu klik — supaya user yang buka browser/device baru tidak perlu tahu harus
 *  klik Import dulu (ini yang bikin bingung sebelumnya: tabel kosong tapi user tidak sadar perlu
 *  import manual). SENGAJA cuma dicek SEKALI saat mount (bukan tiap kali `rows.length` berubah
 *  jadi 0) — supaya kalau user MENGHAPUS semua baris manual, itu tidak otomatis di-import ulang
 *  dan menimpa balik keputusan mereka. Begitu tabel pernah terisi (baik dari import maupun edit
 *  manual), auto-import tidak akan jalan lagi kecuali browser/localStorage benar-benar baru. */
export function ImportSheetButton({ onImport, autoImportIfEmpty = false }: { onImport: () => Promise<number>; autoImportIfEmpty?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const autoTriedRef = useRef(false);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setSuccessCount(null);
    try {
      const count = await onImport();
      setSuccessCount(count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal impor data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (autoImportIfEmpty) handleClick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={loading} variant="accent" size="sm">
        {loading ? "Mengimpor…" : "⇩ Import dari Google Sheets"}
      </Button>
      {error && <div className="max-w-[280px] text-right font-sans text-[10.5px] font-medium leading-[1.4] text-danger-fg">{error}</div>}
      {successCount != null && !error && (
        <div className="font-sans text-[10.5px] font-medium text-success-fg">Berhasil impor {successCount} baris — tabel diganti sepenuhnya.</div>
      )}
    </div>
  );
}
