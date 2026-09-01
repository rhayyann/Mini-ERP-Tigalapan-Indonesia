import { formatPcs } from "@/lib/mrp/derive";
import type { MrpWarnaBreakdown } from "@/lib/mrp/derive";

/** Tabel rincian qty/roll/rib per warna (panjang · pendek · total) — dipakai di baris expand
 *  halaman MRP PPIC & Monitoring SCM supaya tampilannya konsisten di kedua tempat. */
export function MrpWarnaBreakdownTable({ breakdown }: { breakdown: MrpWarnaBreakdown[] }) {
  if (breakdown.length === 0) {
    return <div className="font-sans text-[11.5px] text-text-muted">Belum ada rincian warna/lengan untuk MRP ini (data lama atau tanpa detail import).</div>;
  }
  return (
    <div className="overflow-hidden overflow-x-auto rounded-md border border-[#E4E8EE] bg-white">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-[#E4E8EE] bg-[#F2F4F7] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <th rowSpan={2} className="px-3 py-2 text-left align-bottom">
              Warna
            </th>
            <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
              Qty (pcs)
            </th>
            <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
              Roll
            </th>
            <th colSpan={3} className="border-l border-[#E4E8EE] px-3 py-1.5 text-center">
              Rib (kg)
            </th>
          </tr>
          <tr className="border-b border-[#E4E8EE] bg-[#F2F4F7] font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
            <th className="px-3 py-1.5 text-right">Pendek</th>
            <th className="px-3 py-1.5 text-right">Total</th>
            <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
            <th className="px-3 py-1.5 text-right">Pendek</th>
            <th className="px-3 py-1.5 text-right">Total</th>
            <th className="border-l border-[#E4E8EE] px-3 py-1.5 text-right">Panjang</th>
            <th className="px-3 py-1.5 text-right">Pendek</th>
            <th className="px-3 py-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((w) => (
            <tr key={w.warna} className="border-b border-[#F1F4F7] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
              <td className="px-3 py-2 font-medium">{w.warna}</td>
              <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">{formatPcs(w.qtyPanjang)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatPcs(w.qtyPendek)}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{formatPcs(w.qtyTotal)}</td>
              <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">{w.rollPanjang.toLocaleString("id-ID")}</td>
              <td className="px-3 py-2 text-right font-mono">{w.rollPendek.toLocaleString("id-ID")}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{w.rollTotal.toLocaleString("id-ID")}</td>
              <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">{w.ribPanjang.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
              <td className="px-3 py-2 text-right font-mono">{w.ribPendek.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{w.ribTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
          {breakdown.length > 1 && (
            <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-[11.5px] font-semibold text-info-fg">
              <td className="px-3 py-2">Total semua warna</td>
              <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyPanjang, 0))}</td>
              <td className="px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyPendek, 0))}</td>
              <td className="px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyTotal, 0))}</td>
              <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollPanjang, 0).toLocaleString("id-ID")}</td>
              <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollPendek, 0).toLocaleString("id-ID")}</td>
              <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollTotal, 0).toLocaleString("id-ID")}</td>
              <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                {breakdown.reduce((s, w) => s + w.ribPanjang, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
              </td>
              <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.ribPendek, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
              <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.ribTotal, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
