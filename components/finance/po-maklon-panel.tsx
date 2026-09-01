"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, maklonPoBadge, maklonPoDisplayStatus } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

/** Panel "PO Maklon" — konten diekstrak dari halaman lama /finance/po-maklon,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/po-approval. */
export function PoMaklonPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const approveMaklonPo = useMrpStore((s) => s.approveMaklonPo);

  if (!mounted) return null;

  const pending = maklonPOs.filter((po) => !po.approved);

  const columns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    // Entitas SENGAJA tidak ditampilkan di sini — beda dari PO Material, PO Maklon di sistem ini
    // tidak menggunakan entitas sama sekali (bukan cuma "belum ditentukan").
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) });
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    {
      // default:false — dibatasi ke 7 kolom total (termasuk No. MRP), dan kolom ini hampir
      // selalu "—" kecuali ada line yang dibatalkan Procurement — cukup dicek lewat toggle "Kolom".
      key: "cancelLines",
      label: "Cancel Line (dari Procurement)",
      default: false,
      render: (p) =>
        p.cancelledLines.length ? (
          <div className="flex flex-col gap-1">
            {p.cancelledLines.map((c, i) => (
              <div key={i} className="text-danger-fg">
                {c.warna ? `${c.warna} · ${c.lengan} — ` : ""}
                {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs)` : ""}: {c.note}
              </div>
            ))}
          </div>
        ) : (
          "—"
        ),
    },
    { key: "aksi", label: "Aksi", default: true, render: (p) => (p.approved ? "—" : <Button onClick={() => approveMaklonPo(p.id)} variant="success" size="xs">Approve</Button>) },
  ];

  const recentCancellations = maklonPOs.flatMap((p) => p.cancelledLines.map((c) => ({ po: p, c })));

  return (
    <>
      {pending.length > 0 && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Approve akan memindahkan PO ke dashboard produksi vendor terkait, dan PO material terkait berpindah ke Paying Voucher (Invoice) dengan status <b>waiting invoice</b>.
        </div>
      )}
      {recentCancellations.length > 0 && (
        <div className="rounded-lg border border-[#EFC9C4] bg-danger-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
          <div className="font-semibold">Notifikasi: PO material terkait ditutup oleh Procurement</div>
          {recentCancellations.map(({ po, c }, i) => (
            <div key={i} className="mt-1">
              {VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi} — {po.id}
              {c.warna ? ` · ${c.warna} · ${c.lengan}` : ""} · {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs terpotong)` : ""} — remark: "{c.note}"
            </div>
          ))}
        </div>
      )}
      <DataTable
        title="Semua PO Vendor Produksi"
        columns={columns}
        rows={maklonPOs}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(maklonPOs.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          { label: "No PO", options: Array.from(new Set(maklonPOs.map((p) => p.id))), test: (p, v) => p.id === v },
          {
            label: "Status",
            options: Array.from(new Set(maklonPOs.map((p) => maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) }).label))),
            test: (p, v) => maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) }).label === v,
          },
        ]}
        emptyText="Belum ada PO vendor produksi."
      />
    </>
  );
}
