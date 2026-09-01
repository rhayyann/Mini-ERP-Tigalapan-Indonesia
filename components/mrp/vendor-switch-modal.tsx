"use client";

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[720px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
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
          style={{ gridTemplateColumns: "1fr 1fr 90px 90px 130px" }}
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
              <span className="flex justify-end gap-1">
                {otherVendors.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onSwitch(r.id, v.id)}
                    className="rounded-md border border-[#CBD5DF] px-2.5 py-[5px] font-sans text-[11px] font-semibold text-action-primary"
                  >
                    Switch → {v.name}
                  </button>
                ))}
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">Tidak ada aduan pola di vendor ini.</div>}
        </div>
      </div>
    </div>
  );
}
