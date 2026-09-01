"use client";

import { useState } from "react";
import type { Lengan, MaterialPO } from "@/lib/mrp/types";

type Mode = "CLOSE" | "REASSIGN";

export function ClosePoReasonModal({
  po,
  supplierOptionsForWarna,
  onNo,
  onYes,
}: {
  po: MaterialPO;
  /** Daftar nama supplier lain yang punya harga untuk warna terpilih (untuk mode "Pesan ke
   *  supplier lain") — dihitung ulang oleh pemanggil tiap warna berganti lewat callback ini,
   *  supaya modal tidak perlu tahu soal Master Data Harga Kain sama sekali. */
  supplierOptionsForWarna: (warna: string) => string[];
  onNo: () => void;
  /** newSupplier terisi kalau mode REASSIGN dipilih — PO lama dikurangi seperti biasa, TAPI qty
   *  PO Vendor Produksi TIDAK ikut terpotong (kebutuhan produksi tetap, cuma pindah supplier). */
  onYes: (reason: string, warna: string, lengan: Lengan, closeQty: number, newSupplier?: string) => void;
}) {
  const colorOptions = po.colorBreakdown.map((c) => {
    const key = c.warna + "|" + c.lengan;
    const invoiced = po.invoicedByColor[key] ?? 0;
    return { ...c, remaining: c.rollCount - invoiced };
  });
  const firstAvailable = colorOptions.find((c) => c.remaining > 0);
  const [colorKey, setColorKey] = useState(firstAvailable ? firstAvailable.warna + "|" + firstAvailable.lengan : "");
  const activeColor = colorOptions.find((c) => c.warna + "|" + c.lengan === colorKey);
  const [reason, setReason] = useState("");
  const [closeQty, setCloseQty] = useState(activeColor?.remaining ?? 1);
  const [mode, setMode] = useState<Mode>("CLOSE");
  const [newSupplier, setNewSupplier] = useState("");

  const otherSuppliers = activeColor ? supplierOptionsForWarna(activeColor.warna).filter((s) => s !== po.supplier) : [];

  function selectColor(key: string) {
    setColorKey(key);
    const c = colorOptions.find((cc) => cc.warna + "|" + cc.lengan === key);
    setCloseQty(c?.remaining ?? 1);
    setNewSupplier("");
  }

  const canSubmit = !!activeColor && !!reason.trim() && (mode === "CLOSE" || !!newSupplier);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[480px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className={"flex items-center gap-2.5 px-5 py-3 " + (mode === "CLOSE" ? "bg-danger-bg" : "bg-info-bg")}>
          <span className={"h-2 w-2 rounded-full " + (mode === "CLOSE" ? "bg-danger" : "bg-accent-blue")} />
          <span className={"font-sans text-xs font-semibold " + (mode === "CLOSE" ? "text-danger-fg" : "text-info-fg")}>
            {mode === "CLOSE" ? "Menutup" : "Mengalihkan supplier"} PO {po.id}
          </span>
        </div>
        <div className="px-5 py-4">
          <div className="flex gap-1.5 rounded-md border border-[#DDE4EB] bg-[#F7F9FB] p-1">
            <button
              onClick={() => setMode("CLOSE")}
              className={"flex-1 rounded px-2.5 py-[6px] font-sans text-[11.5px] font-semibold " + (mode === "CLOSE" ? "bg-white text-danger-fg shadow-sm" : "text-text-muted")}
            >
              Tutup permanen
            </button>
            <button
              onClick={() => setMode("REASSIGN")}
              className={"flex-1 rounded px-2.5 py-[6px] font-sans text-[11.5px] font-semibold " + (mode === "REASSIGN" ? "bg-white text-info-fg shadow-sm" : "text-text-muted")}
            >
              Pesan ke supplier lain
            </button>
          </div>
          <div className="mt-1.5 font-sans text-[10.5px] leading-[1.5] text-text-muted">
            {mode === "CLOSE"
              ? "Qty dibatalkan permanen — kebutuhan produksi (PO Vendor Produksi) ikut berkurang."
              : "Supplier lama diganti untuk qty ini — PO material baru dibuat ke supplier baru, kebutuhan produksi TIDAK berkurang."}
          </div>

          <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Warna / lengan</div>
          <select
            value={colorKey}
            onChange={(e) => selectColor(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary"
          >
            {colorOptions
              .filter((c) => c.remaining > 0)
              .map((c) => (
                <option key={c.warna + c.lengan} value={c.warna + "|" + c.lengan}>
                  {c.warna} · {c.lengan} ({c.remaining} roll sisa)
                </option>
              ))}
          </select>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Roll warna ini</div>
              <div className="mt-1 rounded-md border border-[#DDE4EB] bg-[#F7F9FB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary">
                {activeColor?.rollCount ?? 0}
              </div>
            </div>
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">{mode === "CLOSE" ? "Roll ditutup" : "Roll dialihkan"}</div>
              <input
                type="number"
                min={1}
                max={activeColor?.remaining ?? 1}
                value={closeQty}
                onChange={(e) => setCloseQty(Math.max(1, Math.min(activeColor?.remaining ?? 1, Number(e.target.value))))}
                className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary"
              />
            </div>
          </div>
          <div className="mt-1 font-sans text-[11px] text-text-muted">
            Maks {activeColor?.remaining ?? 0} roll (sisa warna ini yang belum diinvoice). Kurang dari itu = {mode === "CLOSE" ? "close" : "alih"} partial untuk warna ini saja.
          </div>

          {mode === "REASSIGN" && (
            <>
              <label className="mt-3 block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Supplier baru</label>
              {otherSuppliers.length === 0 ? (
                <div className="mt-1 rounded-md border border-[#F0DFC2] bg-warning-bg px-[11px] py-[9px] font-sans text-[11.5px] text-warning-fg">
                  Tidak ada supplier lain dengan harga untuk warna {activeColor?.warna} di Master Data Harga Kain.
                </div>
              ) : (
                <select
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
                >
                  <option value="">— pilih supplier baru —</option>
                  {otherSuppliers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          <label className="mt-3 block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Alasan {mode === "CLOSE" ? "penutupan" : "pengalihan"} (remark {mode === "CLOSE" ? "ke vendor produksi" : "internal"})
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: bahan tidak tersedia dari supplier"
            rows={3}
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] text-text-primary"
          />
        </div>
        <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-4">
          <span className="font-sans text-[11.5px] text-text-muted">
            {mode === "CLOSE"
              ? "PO vendor produksi terkait ikut terpotong qty sesuai proporsi roll warna ini, dengan catatan alasan."
              : "PO material baru dibuat ke supplier baru untuk qty ini, menunggu approval Finance seperti PO biasa."}
          </span>
          <div className="ml-auto flex flex-none gap-2">
            <button onClick={onNo} className="rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
              Tidak
            </button>
            <button
              onClick={() => activeColor && reason.trim() && onYes(reason.trim(), activeColor.warna, activeColor.lengan, closeQty, mode === "REASSIGN" ? newSupplier : undefined)}
              disabled={!canSubmit}
              className={"rounded-md px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:opacity-50 " + (mode === "CLOSE" ? "bg-danger" : "bg-action-primary")}
            >
              {mode === "CLOSE" ? "Ya, tutup PO" : "Ya, alihkan ke supplier baru"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
