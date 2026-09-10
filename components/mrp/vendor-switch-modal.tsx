"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPcs } from "@/lib/mrp/derive";
import type { AduanPolaRow } from "@/lib/mrp/types";

export function VendorSwitchModal({
  vendorName,
  rows,
  otherVendors,
  onSwitch,
  onClose,
}: {
  vendorName: string;
  rows: AduanPolaRow[];
  otherVendors: { id: string; name: string }[];
  onSwitch: (aduanId: string, toVendor: string) => void;
  onClose: () => void;
}) {
  // Fix (feedback batch 2026-09-10, owner: "Layoutnya sangat berantakan"): dulu 1 tombol "Switch →
  // {vendor}" PER vendor lain langsung dirender berjajar di kolom terakhir (130px) -- dengan 9
  // vendor produksi terdaftar (VENDOR_PRODUKSI di lib/mrp/seed.ts) itu bisa sampai 8 tombol
  // sekaligus, meluber & tumpang tindih dengan kolom "Panjang lengan" di sebelahnya. Diganti jadi
  // 1 dropdown (pilih vendor tujuan) + 1 tombol "Switch →" per baris, pola sama seperti
  // TransferMaterialModal.
  const [targetByRow, setTargetByRow] = useState<Record<string, string>>({});
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[780px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center border-b border-border-subtle px-5 py-4">
          <div>
            <div className="font-sans text-[17px] font-bold text-text-primary">{vendorName} · rincian kategori &amp; roll</div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">Klik Switch untuk memindahkan aduan pola ke vendor produksi lain</div>
          </div>
          <Button onClick={onClose} variant="ghost" size="xs" className="ml-auto">
            Tutup ✕
          </Button>
        </div>
        <div
          className="grid border-b border-border-subtle bg-[#F7F9FB] px-5 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: "1fr 1fr 90px 90px 200px" }}
        >
          <span>Kategori / warna</span>
          <span>Panjang lengan</span>
          <span className="text-right">Roll</span>
          <span className="text-right">Qty</span>
          <span />
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="grid items-center border-b border-[#F1F4F7] px-5 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0" style={{ gridTemplateColumns: "1fr 1fr 90px 90px 130px" }}>
              <span>
                {r.warna} <span className="font-mono text-text-muted">· {r.kode}</span>
              </span>
              <span>{r.lengan}</span>
              <span className="text-right font-mono">{r.qtyRoll}</span>
              <span className="text-right font-mono">{formatPcs(r.qty)}</span>
              <span className="flex justify-end gap-1.5">
                <select
                  value={targetByRow[r.id] ?? otherVendors[0]?.id ?? ""}
                  onChange={(e) => setTargetByRow((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  className="rounded-md border border-[#DDE4EB] px-1.5 py-[5px] font-sans text-[11px] font-medium text-text-primary"
                >
                  {otherVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onSwitch(r.id, targetByRow[r.id] ?? otherVendors[0]?.id ?? "")}
                  disabled={otherVendors.length === 0}
                  className="rounded-md border border-[#CBD5DF] px-2.5 py-[5px] font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Switch →
                </button>
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">Tidak ada aduan pola di vendor ini.</div>}
        </div>
      </div>
    </div>
  );
}
