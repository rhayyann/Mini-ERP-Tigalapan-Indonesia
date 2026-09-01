"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs } from "@/lib/mrp/derive";
import type { Lengan } from "@/lib/mrp/types";

type ItemRow = { id: number; label: string; size: string; qty: number };

let rowSeq = 4;
const KG_FACTOR = 6.5 / 1000;

export default function InputMrpPage() {
  const router = useRouter();
  const importMrp = useMrpStore((s) => s.importMrp);

  const [warna, setWarna] = useState("Navy 24S");
  const [rows, setRows] = useState<ItemRow[]>([
    { id: 1, label: "Pendek S", size: "S", qty: 360 },
    { id: 2, label: "Pendek M", size: "M", qty: 1080 },
    { id: 3, label: "Pendek L", size: "L", qty: 1800 },
  ]);

  const totalQty = useMemo(() => rows.reduce((a, r) => a + r.qty, 0), [rows]);
  const kg = useMemo(() => Math.round(totalQty * KG_FACTOR * 1000) / 1000, [totalQty]);
  const rollCount = useMemo(() => Math.max(1, Math.round(kg / 0.7645)), [kg]);

  function addRow() {
    rowSeq += 1;
    setRows([...rows, { id: rowSeq, label: "Ukuran baru", size: "-", qty: 0 }]);
  }

  function removeRow(id: number) {
    setRows(rows.filter((r) => r.id !== id));
  }

  function submit() {
    const lengan: Lengan = "PENDEK";
    const groupId = "manual-lg";
    importMrp({
      kategori: "COMBED 24S",
      warna,
      qty: totalQty,
      isFob: false,
      lenganGroups: [
        {
          id: groupId,
          warna,
          lengan,
          sizes: rows.map((r) => ({ size: r.size, qty: r.qty })),
          totalQty,
          ribKg: kg,
          rollEstimate: rollCount,
          vendorDefault: "BAYU",
        },
      ],
      aduanRows: [],
      materialRows: [{ id: "manual-mat", lenganGroupId: groupId, warna, lengan, qtyRoll: rollCount, ribKg: kg, supplier: null }],
    });
    router.push("/mrp/ppic");
  }

  return (
    <AppShell role="ppic" activeHref="/mrp/ppic" breadcrumb={["Dashboard", "MRP saya", "Input manual"]} title="Input MRP manual" subtitle="Fallback tanpa file import — tanpa data aduan pola">
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center border-b border-border-subtle px-5 py-4">
          <div>
            <div className="font-sans text-lg font-bold text-text-primary">Input MRP manual</div>
            <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">Tanpa aduan pola — gunakan Import untuk data lengkap</div>
          </div>
          <StatusPill tone="neutral" className="ml-auto">
            DRAFT
          </StatusPill>
        </div>

        <div className="grid grid-cols-3 gap-3.5 border-b border-[#EEF1F4] px-5 py-4">
          <div>
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Kategori</div>
            <div className="mt-1.5 flex rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary">
              COMBED 24S<span className="ml-auto text-[#94A3B0]">▾</span>
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Warna</div>
            <input
              value={warna}
              onChange={(e) => setWarna(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
            />
          </div>
          <div>
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Target selesai</div>
            <div className="mt-1.5 rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary">20/09/2026</div>
          </div>
        </div>

        <div className="px-5 pb-1.5 pt-3.5 font-sans text-[12.5px] font-semibold text-text-primary">Ukuran &amp; qty (lengan pendek)</div>
        <div
          className="grid gap-x-3 bg-[#F7F9FB] px-5 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: "1.6fr 1fr 40px" }}
        >
          <span>Ukuran</span>
          <span className="text-right">Qty</span>
          <span />
        </div>
        {rows.map((r) => (
          <div key={r.id} className="grid items-center gap-x-3 border-b border-[#F1F4F7] px-5 py-[9px] font-sans text-xs text-[#31414F]" style={{ gridTemplateColumns: "1.6fr 1fr 40px" }}>
            <span>{r.label}</span>
            <span className="text-right font-mono">{formatPcs(r.qty)}</span>
            <button onClick={() => removeRow(r.id)} className="text-center text-danger-fg">
              ×
            </button>
          </div>
        ))}
        <div className="border-b border-[#EEF1F4] px-5 py-[9px]">
          <button onClick={addRow} className="rounded-md border border-dashed border-[#CBD5DF] px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-text-muted">
            + tambah ukuran
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3.5 bg-[#F7F9FB] px-5 py-3">
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Total qty</div>
            <div className="mt-[3px] font-mono text-lg font-bold text-text-primary">{formatPcs(totalQty)} pcs</div>
          </div>
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Kebutuhan rib</div>
            <div className="mt-[3px] font-mono text-lg font-bold text-text-primary">{kg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg</div>
          </div>
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Qty roll (estimasi)</div>
            <div className="mt-[3px] font-mono text-lg font-bold text-text-primary">{rollCount}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-4">
          <button onClick={submit} className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white">
            Submit MRP
          </button>
          <span className="ml-auto font-sans text-[11.5px] text-text-muted">Untuk aduan pola lengkap, gunakan Import di halaman MRP</span>
        </div>
      </div>
    </AppShell>
  );
}
