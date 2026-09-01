"use client";

import { useState } from "react";

export function DownloadLampiranModal({
  invoiceIds,
  initialOngkir,
  onCancel,
  onConfirm,
}: {
  invoiceIds: string[];
  initialOngkir?: Record<string, number>;
  onCancel: () => void;
  onConfirm: (ongkirByInvoice: Record<string, number>) => void;
}) {
  const [ongkirByInvoice, setOngkirByInvoice] = useState<Record<string, number>>(
    Object.fromEntries(invoiceIds.map((id) => [id, initialOngkir?.[id] ?? 0]))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[460px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="px-5 py-4">
          <div className="font-sans text-[17px] font-bold text-text-primary">Download Lampiran Invoice</div>
          <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">
            Masukkan total biaya ongkos kirim untuk masing-masing invoice (dari invoice ekspedisi), untuk menghitung ongkir per pcs.
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto px-5 pb-1">
          {invoiceIds.map((id) => (
            <div key={id} className="mt-2">
              <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Total ongkos kirim — {id}</label>
              <input
                type="number"
                min={0}
                value={ongkirByInvoice[id] ?? 0}
                onChange={(e) => setOngkirByInvoice((prev) => ({ ...prev, [id]: Math.max(0, Number(e.target.value)) }))}
                className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border-subtle px-5 py-4">
          <button onClick={onCancel} className="ml-auto rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <button onClick={() => onConfirm(ongkirByInvoice)} className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white">
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
