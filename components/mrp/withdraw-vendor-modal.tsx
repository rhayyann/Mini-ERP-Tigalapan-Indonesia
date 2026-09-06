"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPcs, formatRupiah } from "@/lib/mrp/derive";

/** Modal "Vendor Berhenti Produksi" -- pola mirip VendorSwitchModal, tapi beroperasi di level 1
 *  PO Produksi PENUH (bukan per baris aduan pola), lihat withdrawVendorProductionAction di
 *  lib/mrp/actions.ts. Dipakai dari Procurement > Material Tracking (section "PO Produksi aktif"). */
export function WithdrawVendorModal({
  mrpId,
  fromVendorName,
  qty,
  amount,
  otherVendors,
  onConfirm,
  onClose,
}: {
  mrpId: string;
  fromVendorName: string;
  qty: number;
  amount: number;
  otherVendors: { id: string; name: string }[];
  onConfirm: (toVendor: string) => Promise<void>;
  onClose: () => void;
}) {
  const [toVendor, setToVendor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!toVendor) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(toVendor);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memindahkan produksi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[560px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center border-b border-border-subtle px-5 py-4">
          <div>
            <div className="font-sans text-[17px] font-bold text-text-primary">Vendor Berhenti Produksi</div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">
              {mrpId} — {fromVendorName}
            </div>
          </div>
          <Button onClick={onClose} variant="ghost" size="xs" className="ml-auto">
            Tutup ✕
          </Button>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-md border border-[#E4E8EE] bg-[#FAFBFC] px-3.5 py-3 font-sans text-[11.5px] leading-[1.5] text-[#31414F]">
            <b>{fromVendorName}</b> berhenti produksi untuk PO ini ({formatPcs(qty)} pcs, {formatRupiah(amount)}). Bahan mentah yang belum dipotong DAN roll
            yang sudah di-Resting/Cutting tapi belum jadi Finish Good akan dipindahkan SEKALIGUS ke vendor tujuan — vendor ini tidak akan bisa lagi
            melakukan produksi baru (Resting/Cutting/Finish Good) untuk PO ini. Finish Good yang sudah ada TETAP di vendor ini, tetap bisa dikirim &amp;
            ditagih seperti biasa.
          </div>

          <div className="mt-3">
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Pindahkan sisa pekerjaan ke</div>
            <select value={toVendor} onChange={(e) => setToVendor(e.target.value)} className="input mt-1">
              <option value="">— pilih vendor tujuan —</option>
              {otherVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="mt-2.5 font-sans text-[11.5px] text-danger-fg">{error}</div>}

          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={onClose} variant="ghost" size="sm">
              Batal
            </Button>
            <Button onClick={submit} disabled={!toVendor || submitting} variant="danger" size="sm">
              {submitting ? "Memindahkan…" : "Pindahkan & Tandai Berhenti"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
