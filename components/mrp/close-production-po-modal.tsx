"use client";

import { useState } from "react";

/** Item 21.4 (feedback batch 2026-09-04) -- modal "Close PO" untuk PO Produksi (maklon_pos), versi
 *  SEDERHANA dari components/mrp/close-po-reason-modal.tsx (yang untuk PO Material Procurement,
 *  punya pilihan warna/lengan/qty/reassign supplier -- tidak relevan di sini karena Close PO Produksi
 *  SELALU menutup SEMUA warna/lengan PO ini sekaligus, lihat closeProductionPoAction). Cuma alasan. */
export function CloseProductionPoModal({ maklonPoId, onNo, onYes }: { maklonPoId: string; onNo: () => void; onYes: (reason: string) => void }) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[440px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center gap-2.5 bg-danger-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-danger" />
          <span className="font-sans text-xs font-semibold text-danger-fg">Menutup PO Produksi {maklonPoId}</span>
        </div>
        <div className="px-5 py-4">
          <div className="rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2.5 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
            Menutup PO ini akan mengunci SEMUA warna/lengan di PO ini dan sisa Finish Good yang belum masuk koli tidak akan bisa dikirim lagi.
          </div>
          <label className="mt-3 block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Alasan penutupan</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: sisa order dibatalkan buyer"
            rows={3}
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] text-text-primary"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
          <button onClick={onNo} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <button
            onClick={() => reason.trim() && onYes(reason.trim())}
            disabled={!reason.trim()}
            className="rounded-md bg-danger px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ya, Close PO
          </button>
        </div>
      </div>
    </div>
  );
}
