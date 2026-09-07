"use client";

import { useState } from "react";

/** Item revisi 2026-09-07 (owner: tombol "Tutup Roll" & aksi lain di halaman Vendor Produksi
 *  terasa lambat -- "belum diterapkan fitur yang loadingnya jalan di belakang layar, bukan di
 *  tampilan user"): SEBELUM ini, pola `runAction(promise)` yang dipakai berulang di beberapa
 *  komponen Produksi (lihat production-result-panel.tsx/production-final-tab.tsx) MURNI penangkap
 *  error (tangkap ke banner) -- tombolnya sendiri TIDAK di-disable & TIDAK ada tanda visual apa pun
 *  selama request masih berjalan, jadi klik terasa "tidak ngapa-ngapain" sampai snapshot ter-refresh
 *  (bisa beberapa detik), padahal request-nya sendiri sudah jalan dari awal.
 *
 *  Hook ini menggantikan pola itu -- selain menangkap error, juga melacak KEY per-aksi (bukan 1
 *  flag global) yang lagi "in flight", supaya tombol lain di baris/roll LAIN dalam daftar yang sama
 *  (mis. banyak "Tutup Roll" untuk roll berbeda) tetap bisa diklik sementara SATU permintaan lain
 *  sedang diproses -- disable per-baris, bukan mengunci seluruh daftar. */
export function usePendingActions() {
  const [pending, setPending] = useState<Set<string>>(new Set());

  function isPending(key: string): boolean {
    return pending.has(key);
  }

  /** Jalankan `promise` sambil menandai `key` sebagai pending (dipakai untuk `disabled={isPending(key)}`
   *  di tombol yang memicunya) -- error ditangkap & diteruskan ke `onError` (biasanya `setActionError`
   *  yang sudah ada), TIDAK di-throw ulang (pola sama seperti runAction lama). */
  function run(key: string, promise: Promise<unknown>, onError?: (message: string) => void): void {
    setPending((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    promise
      .catch((err) => onError?.(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  }

  return { isPending, run };
}
