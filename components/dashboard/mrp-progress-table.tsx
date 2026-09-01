"use client";

import { useState } from "react";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, mrpProgressRows, type MrpProgressStage } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

const STAGE_COLS: { key: keyof MrpProgressStage; label: string; unit: string }[] = [
  { key: "po", label: "PO", unit: "pcs" },
  { key: "invoice", label: "Invoice", unit: "roll" },
  { key: "paidMaterial", label: "Paid Material", unit: "roll" },
  { key: "rcvMaterial", label: "Rcv Material", unit: "roll" },
  { key: "cutting", label: "Cutting", unit: "roll" },
  { key: "fg", label: "FG", unit: "pcs" },
  { key: "delivery", label: "Delivery", unit: "pcs" },
];

function StageCell({ value }: { value: number }) {
  return <span className="text-right font-mono">{formatPcs(value)}</span>;
}

export function MrpProgressTable() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);

  const [expandedMrp, setExpandedMrp] = useState<string | null>(null);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

  const rows = mrpProgressRows(mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, productionBatches, productionResults, deliveryKolis);

  function toggleMrp(mrpId: string) {
    setExpandedMrp((prev) => (prev === mrpId ? null : mrpId));
    setExpandedVendor(null);
  }

  function toggleVendor(key: string) {
    setExpandedVendor((prev) => (prev === key ? null : key));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="font-sans text-[13px] font-semibold text-text-primary">End-to-end proses per MRP</div>
        <div className="mt-0.5 font-sans text-[11px] text-text-muted">
          Klik baris MRP untuk drill-down by vendor, klik baris vendor untuk drill-down by warna.
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[110px_90px_repeat(7,1fr)] border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>No MRP</span>
            <span className="text-right">MRP (qty)</span>
            {STAGE_COLS.map((c) => (
              <span key={c.key} className="text-right">
                {c.label}
              </span>
            ))}
          </div>

          {rows.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada MRP.</div>}

          {rows.map((r) => {
            const mrpExpanded = expandedMrp === r.mrpId;
            return (
              <div key={r.mrpId}>
                <button
                  onClick={() => toggleMrp(r.mrpId)}
                  className="grid w-full grid-cols-[110px_90px_repeat(7,1fr)] items-center border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]"
                >
                  <span className="font-mono font-medium">
                    <span className="mr-1 inline-block w-3 text-text-muted">{mrpExpanded ? "▾" : "▸"}</span>
                    {r.mrpId}
                  </span>
                  <StageCell value={r.mrpQty} />
                  {STAGE_COLS.map((c) => (
                    <StageCell key={c.key} value={r[c.key]} />
                  ))}
                </button>

                {mrpExpanded &&
                  r.vendorRows.map((v) => {
                    const vendorKey = r.mrpId + "|" + v.vendorProduksi;
                    const vendorExpanded = expandedVendor === vendorKey;
                    return (
                      <div key={vendorKey}>
                        <button
                          onClick={() => toggleVendor(vendorKey)}
                          className="grid w-full grid-cols-[110px_90px_repeat(7,1fr)] items-center border-b border-[#F1F4F7] bg-[#FAFBFC] px-4 py-[9px] pl-8 text-left font-sans text-[11.5px] text-[#31414F] hover:bg-[#F1F4F7]"
                        >
                          <span className="col-span-2 flex items-center gap-1.5">
                            <span className="w-3 text-text-muted">{vendorExpanded ? "▾" : "▸"}</span>
                            {VENDOR_PRODUKSI[v.vendorProduksi]?.name ?? v.vendorProduksi}
                          </span>
                          {STAGE_COLS.map((c) => (
                            <StageCell key={c.key} value={v[c.key]} />
                          ))}
                        </button>

                        {vendorExpanded &&
                          v.warnaRows.map((w) => (
                            <div
                              key={w.warna + "|" + w.lengan}
                              className="grid grid-cols-[110px_90px_repeat(7,1fr)] items-center border-b border-[#F1F4F7] bg-white px-4 py-[9px] pl-14 font-sans text-[11px] text-text-muted"
                            >
                              <span className="col-span-2">
                                {w.warna} · {w.lengan}
                              </span>
                              {STAGE_COLS.map((c) => (
                                <StageCell key={c.key} value={w[c.key]} />
                              ))}
                            </div>
                          ))}
                        {vendorExpanded && v.warnaRows.length === 0 && (
                          <div className="border-b border-[#F1F4F7] bg-white px-4 py-2 pl-14 font-sans text-[11px] text-text-muted">Belum ada data warna.</div>
                        )}
                      </div>
                    );
                  })}
                {mrpExpanded && r.vendorRows.length === 0 && (
                  <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-4 py-2 pl-8 font-sans text-[11px] text-text-muted">Belum ada vendor untuk MRP ini.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
