"use client";

import { formatPcs, formatRupiah, hargaMaklonRate } from "@/lib/mrp/derive";
import type { HargaMaklonRow } from "@/lib/mrp/masterData";
import type { AduanPolaRow, Lengan } from "@/lib/mrp/types";

/** Item 4 (feedback batch 2026-09-10, owner: "PO Approval Maklon itu lebih detail ke tipe lengan
 *  juga untuk qty-nya (panjang pendek) serta estimasi harga per warna dan tipe lengan"): tabel
 *  detail per-warna dengan qty & harga Pendek/Panjang dipisah -- diekstrak dari
 *  `app/procurement/po-approval/page.tsx` (item revisi 2026-09-08) supaya bisa dipakai bareng di
 *  Finance > PO Approval > PO Maklon (`components/finance/po-maklon-panel.tsx`), yang sebelumnya
 *  punya tabel detail lebih polos (warna·lengan digabung 1 baris, tanpa harga). Satu sumber
 *  kebenaran untuk layout ini -- rate per lengan dihitung dari qty KUMULATIF SELURUH PO (lintas
 *  warna), formula PERSIS sama seperti `maklonRateExplanation` (badge "Standar/PKS" di kolom
 *  Nilai level-PO), supaya rate yang tampil di sini selalu konsisten dengan yang benar-benar
 *  dipakai untuk menghitung `amount`. */
export function MaklonPoWarnaLenganTable({
  vendorProduksi,
  amount,
  aduanRows,
  hargaMaklon,
}: {
  vendorProduksi: string;
  amount: number;
  /** Sudah difilter ke PO ini (vendor + mrpId) oleh caller. */
  aduanRows: AduanPolaRow[];
  hargaMaklon: HargaMaklonRow[];
}) {
  if (aduanRows.length === 0) {
    return <div className="font-sans text-[11.5px] text-text-muted">Belum ada rincian aduan pola untuk PO ini.</div>;
  }
  const qtyByLengan = new Map<Lengan, number>();
  for (const a of aduanRows) qtyByLengan.set(a.lengan, (qtyByLengan.get(a.lengan) ?? 0) + a.qty);
  const rateByLengan: Record<"PENDEK" | "PANJANG", number> = {
    PENDEK: hargaMaklonRate(hargaMaklon, vendorProduksi, "PENDEK", qtyByLengan.get("PENDEK") ?? 0),
    PANJANG: hargaMaklonRate(hargaMaklon, vendorProduksi, "PANJANG", qtyByLengan.get("PANJANG") ?? 0),
  };
  const byWarna = new Map<string, { pendek: number; panjang: number }>();
  for (const a of aduanRows) {
    const cur = byWarna.get(a.warna) ?? { pendek: 0, panjang: 0 };
    if (a.lengan === "PENDEK") cur.pendek += a.qty;
    else cur.panjang += a.qty;
    byWarna.set(a.warna, cur);
  }
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
      <div className="grid grid-cols-6 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>Warna</span>
        <span className="text-right">Qty Pendek</span>
        <span className="text-right">Harga/Pc Pendek</span>
        <span className="text-right">Qty Panjang</span>
        <span className="text-right">Harga/Pc Panjang</span>
        <span className="text-right">Subtotal</span>
      </div>
      {Array.from(byWarna.entries()).map(([warna, q]) => {
        const subtotal = q.pendek * rateByLengan.PENDEK + q.panjang * rateByLengan.PANJANG;
        return (
          <div key={warna} className="grid grid-cols-6 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
            <span className="font-medium">{warna}</span>
            <span className="text-right font-mono">{q.pendek > 0 ? formatPcs(q.pendek) : "—"}</span>
            <span className="text-right font-mono">{q.pendek > 0 ? formatRupiah(rateByLengan.PENDEK) : "—"}</span>
            <span className="text-right font-mono">{q.panjang > 0 ? formatPcs(q.panjang) : "—"}</span>
            <span className="text-right font-mono">{q.panjang > 0 ? formatRupiah(rateByLengan.PANJANG) : "—"}</span>
            <span className="text-right font-mono">{formatRupiah(subtotal)}</span>
          </div>
        );
      })}
      <div className="grid grid-cols-6 gap-x-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[11.5px] font-semibold text-info-fg">
        <span className="col-span-5">Total</span>
        <span className="text-right font-mono">{formatRupiah(amount)}</span>
      </div>
    </div>
  );
}
