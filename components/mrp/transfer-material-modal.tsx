"use client";

import { useState } from "react";
import { localDateString } from "@/lib/mrp/derive";
import type { Lengan } from "@/lib/mrp/types";

// Item 2 (feedback batch 2026-09-10, owner: "Buat agar procurement bisa memindahkan warna saja
// juga ... nanti ada opsi pilih warna dulu baru pilih berapa roll dari warna itu yang ingin
// dipindahkan"): dulu 1 TransferCandidate = 1 invoice, `warna` sudah digabung jadi 1 string
// ("ABU MUDA 24S, BEIGE 24S") dan qtyReady = total roll SEMUA warna invoice itu -- tidak ada cara
// pilih 1 warna saja. Sekarang 1 TransferCandidate = 1 (invoiceId, warna, lengan) -- baris
// terpisah per warna/lengan, tetap dikelompokkan di UI di bawah judul invoice/PO-nya.
export type TransferCandidate = { id: string; invoiceId: string; mrpId: string; poId: string; warna: string; lengan: Lengan; qtyReady: number };

function todayIso() {
  return localDateString(new Date());
}

export function TransferMaterialModal({
  items,
  vendors,
  onCancel,
  onConfirm,
}: {
  items: TransferCandidate[];
  vendors: { id: string; name: string }[];
  onCancel: () => void;
  // items: {invoiceId, warna, lengan, qty}[] -- lihat lib/mrp/actions.ts transferMaterialAction,
  // sekarang butuh tahu warna/lengan mana yang dipilih, bukan cuma total qty per invoice.
  onConfirm: (toVendor: string, items: { invoiceId: string; warna: string; lengan: Lengan; qty: number }[], deliveryDate: string) => void;
}) {
  const [target, setTarget] = useState(vendors[0]?.id ?? "");
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [qtyById, setQtyById] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.id, i.qtyReady])));

  function setQty(id: string, value: number, max: number) {
    setQtyById((prev) => ({ ...prev, [id]: Math.max(0, Math.min(value, max)) }));
  }

  const totalQty = Object.values(qtyById).reduce((s, q) => s + q, 0);

  // Kelompokkan baris per invoice (poId) murni untuk tampilan -- 1 invoice bisa punya beberapa
  // baris warna/lengan, ditampilkan menyatu di bawah 1 header "No PO".
  const byPo = new Map<string, TransferCandidate[]>();
  for (const it of items) {
    const arr = byPo.get(it.poId) ?? [];
    arr.push(it);
    byPo.set(it.poId, arr);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[620px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="px-5 py-4">
          <div className="font-sans text-[17px] font-bold text-text-primary">Pindahkan material</div>
          <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">
            Vendor produksi tujuan akan mendapat notifikasi, target produksi (PO Vendor Produksi) ikut pindah mengikuti aduan pola. Pilih warna &amp; qty roll
            per warna yang ingin dipindahkan.
          </div>
        </div>
        <div className="px-5 pb-1">
          <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Vendor produksi tujuan</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary">
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="px-5 pb-1 pt-3">
          <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Tanggal delivery ke vendor tujuan</label>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary"
          />
        </div>
        <div className="mt-3 max-h-[280px] overflow-y-auto px-5">
          <div className="grid grid-cols-4 gap-2 border-b border-[#F1F4F7] pb-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <span>Warna · lengan</span>
            <span className="text-right">Roll belum dipotong</span>
            <span className="text-right">Qty dipindahkan</span>
            <span />
          </div>
          {Array.from(byPo.entries()).map(([poId, rows]) => (
            <div key={poId} className="border-b border-[#F1F4F7] py-1.5 last:border-b-0">
              <div className="pt-1 font-mono text-[10.5px] font-semibold text-text-muted">{poId}</div>
              {rows.map((it) => (
                <div key={it.id} className="grid grid-cols-4 items-center gap-2 py-1.5 font-mono text-[11.5px] text-[#31414F]">
                  <span className="font-sans">
                    {it.warna} <span className="text-text-muted">· {it.lengan}</span>
                  </span>
                  <span className="text-right">{it.qtyReady}</span>
                  <input
                    type="number"
                    min={0}
                    max={it.qtyReady}
                    value={qtyById[it.id] ?? 0}
                    onChange={(e) => setQty(it.id, Number(e.target.value), it.qtyReady)}
                    className="w-full rounded-md border border-[#DDE4EB] px-2 py-1 text-right"
                  />
                  <span />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-4 mt-3">
          <span className="font-sans text-[11px] text-text-muted">Total {totalQty} roll akan dipindahkan.</span>
          <button onClick={onCancel} className="ml-auto rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
            Batal
          </button>
          <button
            onClick={() => {
              if (!target || totalQty <= 0 || !deliveryDate) return;
              const payload = items
                .filter((it) => (qtyById[it.id] ?? 0) > 0)
                .map((it) => ({ invoiceId: it.invoiceId, warna: it.warna, lengan: it.lengan, qty: qtyById[it.id] ?? 0 }));
              onConfirm(target, payload, deliveryDate);
            }}
            disabled={!target || totalQty <= 0 || !deliveryDate}
            className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:opacity-50"
          >
            Pindahkan
          </button>
        </div>
      </div>
    </div>
  );
}
