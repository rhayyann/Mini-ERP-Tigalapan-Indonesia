"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, maklonPoBadgeWithApproval, maklonPoDeliveryProgress, maklonPoInvoiceLockedBy, vendorItemSizeProgress } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO } from "@/lib/mrp/types";

/** Item 2026-09-12 (user-requested, revisi ke-2 -- versi tabel per-size sebelumnya kaku & makan
 *  tempat): 1 baris ringkas per warna/lengan dengan mini progress bar (FG vs target), size cuma
 *  ditampilkan sebagai chip kecil dan BOLEH di-collapse (default collapse kalau belum ada progres
 *  sama sekali, supaya PO yang masih 0 tidak langsung menuh-menuhin layar) -- klik untuk buka
 *  rincian per size. Sumber data & rumus TIDAK berubah dari revisi sebelumnya (vendorItemSizeProgress,
 *  lib/mrp/derive.ts) -- ini murni perubahan tampilan. */
function MaklonPoItemProgress({ po }: { po: MaklonPO }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const rows = vendorItemSizeProgress(po.mrpId, po.vendorProduksi, mrpDetails, productionBatches, productionResults);

  const groups = new Map<string, { warna: string; lengan: string; rows: typeof rows }>();
  for (const r of rows) {
    const key = r.warna + "|" + r.lengan;
    if (!groups.has(key)) groups.set(key, { warna: r.warna, lengan: r.lengan, rows: [] });
    groups.get(key)!.rows.push(r);
  }

  function toggle(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-[#E4E9EE] bg-white">
      <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        Progres per item (dari rencana Aduan Pola) — klik baris untuk rincian per size
      </div>
      {rows.length === 0 ? (
        <div className="border-t border-[#F1F4F7] px-3 py-2 font-sans text-[11.5px] text-text-muted">
          Belum ada rencana Aduan Pola untuk vendor ini di MRP tsb.
        </div>
      ) : (
        <div className="divide-y divide-[#F1F4F7]">
          {Array.from(groups.values()).map((g) => {
            const key = g.warna + "|" + g.lengan;
            const open = openGroups.has(key);
            const s = g.rows.reduce(
              (a, r) => ({ target: a.target + r.target, cutting: a.cutting + r.cutting, finishGood: a.finishGood + r.finishGood, reject: a.reject + r.reject, rework: a.rework + r.rework }),
              { target: 0, cutting: 0, finishGood: 0, reject: 0, rework: 0 }
            );
            const fgPct = s.target > 0 ? Math.min(100, (s.finishGood / s.target) * 100) : 0;
            const cuttingPct = s.target > 0 ? Math.min(100, (s.cutting / s.target) * 100) : 0;
            return (
              <div key={key}>
                <button onClick={() => toggle(key)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#FAFBFC]">
                  <span className="flex-none text-text-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  <span className="w-[180px] flex-none truncate font-sans text-[11.5px] font-medium text-[#31414F]">
                    {g.warna} · {g.lengan}
                  </span>
                  <span className="flex-1">
                    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-[#EEF0F3]">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-[#CFE0EF]" style={{ width: `${cuttingPct}%` }} />
                      <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${fgPct}%` }} />
                    </span>
                  </span>
                  <span className="w-[90px] flex-none text-right font-mono text-[11px] text-text-muted">
                    {formatPcs(s.finishGood)}/{formatPcs(s.target)}
                  </span>
                  {(s.reject > 0 || s.rework > 0) && (
                    <span className="flex-none font-sans text-[10px]">
                      {s.reject > 0 && <span className="text-danger-fg">−{formatPcs(s.reject)} reject</span>}
                      {s.reject > 0 && s.rework > 0 && " · "}
                      {s.rework > 0 && <span className="text-warning-fg">{formatPcs(s.rework)} rework</span>}
                    </span>
                  )}
                  <span className="w-[52px] flex-none text-right font-mono text-[11px] font-semibold text-[#31414F]">
                    {s.cutting > 0 ? `${((s.finishGood / s.cutting) * 100).toFixed(0)}%` : "—"}
                  </span>
                </button>
                {open && (
                  <div className="flex flex-wrap gap-1.5 border-t border-[#F1F4F7] bg-[#FAFBFC] px-3 py-2 pl-9">
                    {g.rows.map((r) => (
                      <span
                        key={r.size}
                        title={`Target ${r.target} · Cutting ${r.cutting} · FG ${r.finishGood}${r.reject ? ` · Reject ${r.reject}` : ""}${r.rework ? ` · Rework ${r.rework}` : ""}`}
                        className="rounded border border-[#E4E9EE] bg-white px-2 py-1 font-mono text-[10.5px] text-[#31414F]"
                      >
                        <span className="font-semibold">{r.size}</span> {formatPcs(r.finishGood)}/{formatPcs(r.target)}
                        {r.reject > 0 && <span className="text-danger-fg"> −{r.reject}</span>}
                        {r.rework > 0 && <span className="text-warning-fg"> +{r.rework}rw</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ProduksiMonitoringPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  if (!mounted) return null;

  const rows = maklonPOs.filter((p) => p.approved);

  const columns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) + " pcs" },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadgeWithApproval(p, vendorInvoices);
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    {
      key: "progress",
      label: "Progress kirim/tagih",
      default: true,
      render: (p) => {
        // Kalau ditagih lewat jalur Invoice Maklon lama (lump sum), progress qty-per-pcs di bawah
        // tidak relevan — sama seperti catatan di app/procurement/po-approval/page.tsx.
        const lockedBy = maklonPoInvoiceLockedBy(p.mrpId, p.vendorProduksi, maklonInvoices, vendorInvoices);
        if (lockedBy === "maklon") {
          return <span className="font-sans text-[11px] font-medium text-text-muted">Ditagih via Invoice Maklon (lump sum)</span>;
        }
        const prog = maklonPoDeliveryProgress(p, deliveryKolis, vendorInvoices);
        return (
          <div className="flex min-w-[150px] flex-col gap-1.5">
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Kirim</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.deliveredQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-success" style={{ width: `${prog.deliveredPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.deliveredPct}%</span>
            </div>
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Tagih</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.invoicedQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${prog.invoicedPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.invoicedPct}%</span>
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/monitoring"
      breadcrumb={["Dashboard", "Monitoring Produksi"]}
      title="Monitoring Produksi"
      subtitle={`${rows.length} PO vendor produksi — progres kirim & tagih lintas semua vendor`}
    >
      <DataTable
        title="PO vendor produksi"
        subtitle="Klik baris untuk lihat progres produksi per item (warna/lengan) — target, cutting, finish good, reject, rework"
        columns={columns}
        rows={rows}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        renderExpanded={(p) => <MaklonPoItemProgress po={p} />}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          {
            label: "Vendor",
            options: Array.from(new Set(rows.map((p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi))),
            test: (p, v) => (VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi) === v,
          },
          {
            label: "Status",
            options: Array.from(new Set(rows.map((p) => maklonPoBadgeWithApproval(p, vendorInvoices).label))),
            test: (p, v) => maklonPoBadgeWithApproval(p, vendorInvoices).label === v,
          },
        ]}
        emptyText="Belum ada PO vendor produksi yang disetujui Finance."
      />
    </AppShell>
  );
}
