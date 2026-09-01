"use client";

import { useState } from "react";
import { localDateString } from "@/lib/mrp/derive";

function todayIso() {
  return localDateString(new Date());
}

export function SetDeliveryModal({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: (deliveryDate: string) => void;
}) {
  const [date, setDate] = useState(todayIso());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[400px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="px-5 py-4">
          <div className="font-sans text-[17px] font-bold text-text-primary">Set Delivery — {count} invoice</div>
          <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">Status berubah dari PAID menjadi DELIVERY.</div>
        </div>
        <div className="px-5 pb-1">
          <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Tanggal delivery</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary"
          />
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border-subtle px-5 py-4">
          <button onClick={onCancel} className="ml-auto rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <button onClick={() => date && onConfirm(date)} disabled={!date} className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:opacity-50">
            Set Delivery
          </button>
        </div>
      </div>
    </div>
  );
}
