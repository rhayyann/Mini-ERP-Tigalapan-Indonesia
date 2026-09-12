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

type MrpGroup = { mrpId: string; vendorPOs: MaklonPO[] };

/** Baris ringkas 1 vendor (dipakai di dalam drill-down langkah 1) -- mirror kolom
 *  "Progress kirim/tagih" yang tadinya di kolom tabel utama, sekarang jadi baris klik-able. */
function VendorPoRow({
  po,
  selected,
  onSelect,
  deliveryKolis,
  vendorInvoices,
  maklonInvoices,
}: {
  po: MaklonPO;
  selected: boolean;
  onSelect: () => void;
  deliveryKolis: ReturnType<typeof useMrpStore.getState>["deliveryKolis"];
  vendorInvoices: ReturnType<typeof useMrpStore.getState>["vendorInvoices"];
  maklonInvoices: ReturnType<typeof useMrpStore.getState>["maklonInvoices"];
}) {
  const badge = maklonPoBadgeWithApproval(po, vendorInvoices);
  const lockedBy = maklonPoInvoiceLockedBy(po.mrpId, po.vendorProduksi, maklonInvoices, vendorInvoices);
  const prog = lockedBy === "maklon" ? null : maklonPoDeliveryProgress(po, deliveryKolis, vendorInvoices);
  return (
    <button
      onClick={onSelect}
      className={"flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left " + (selected ? "border-action-primary bg-info-bg" : "border-[#E4E9EE] bg-white hover:bg-[#FAFBFC]")}
    >
      <span className="w-[140px] flex-none truncate font-sans text-[12px] font-semibold text-[#31414F]">{VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi}</span>
      <span className="w-[90px] flex-none font-mono text-[11px] text-text-muted">{formatPcs(po.qty)} pcs</span>
      <span className="w-[110px] flex-none font-mono text-[11px] text-text-muted">{formatRupiah(po.amount)}</span>
      <StatusPill tone={badge.tone} className="flex-none">
        {badge.label}
      </StatusPill>
      <span className="flex-1">
        {prog ? (
          <span className="flex items-center gap-1.5">
            <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-[#EEF0F3]">
              <span className="absolute inset-y-0 left-0 rounded-full bg-accent-blue" style={{ width: `${prog.invoicedPct}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${prog.deliveredPct}%` }} />
            </span>
            <span className="flex-none font-mono text-[10.5px] text-text-muted">{prog.deliveredPct}%</span>
          </span>
        ) : (
          <span className="font-sans text-[10.5px] text-text-muted">Ditagih via Invoice Maklon (lump sum)</span>
        )}
      </span>
      <span className="flex-none text-text-muted">{selected ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
    </button>
  );
}

/** Item 2026-09-12 (user-requested, revisi ke-3): hierarki 2 langkah -- 1 baris per MRP di tabel
 *  utama (bukan 1 baris per MRP+vendor lagi), klik baris MRP membuka daftar vendor yang mengerjakan
 *  MRP itu, klik salah satu vendor baru menampilkan MaklonPoItemProgress-nya. Pola sama persis
 *  dengan drill-down MRP->vendor->item di app/finance/laporan-hpp/page.tsx (MrpVendorDrilldown),
 *  dipakai lagi di sini supaya konsisten. State pilihan vendor lokal per baris MRP (reset tiap
 *  collapse->expand karena DataTable cuma me-mount renderExpanded selagi baris itu expanded). */
function MrpVendorDrilldown({ group }: { group: MrpGroup }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  const selected = group.vendorPOs.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-2">
      {selected && (
        <button onClick={() => setSelectedId(null)} className="self-start font-sans text-[11.5px] font-semibold text-action-primary underline">
          ← Ganti vendor ({group.vendorPOs.length} vendor mengerjakan MRP ini)
        </button>
      )}
      {!selected ? (
        <div className="flex flex-col gap-1.5">
          {group.vendorPOs.map((po) => (
            <VendorPoRow
              key={po.id}
              po={po}
              selected={false}
              onSelect={() => setSelectedId(po.id)}
              deliveryKolis={deliveryKolis}
              vendorInvoices={vendorInvoices}
              maklonInvoices={maklonInvoices}
            />
          ))}
        </div>
      ) : (
        <MaklonPoItemProgress po={selected} />
      )}
    </div>
  );
}

export default function ProduksiMonitoringPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  if (!mounted) return null;

  const approved = maklonPOs.filter((p) => p.approved);
  const mrpMap = new Map<string, MrpGroup>();
  for (const p of approved) {
    if (!mrpMap.has(p.mrpId)) mrpMap.set(p.mrpId, { mrpId: p.mrpId, vendorPOs: [] });
    mrpMap.get(p.mrpId)!.vendorPOs.push(p);
  }
  const rows = Array.from(mrpMap.values()).sort((a, b) => a.mrpId.localeCompare(b.mrpId));

  const columns: ColumnDef<MrpGroup>[] = [
    {
      key: "vendorCount",
      label: "Vendor",
      default: true,
      render: (g) => (g.vendorPOs.length === 1 ? (VENDOR_PRODUKSI[g.vendorPOs[0].vendorProduksi]?.name ?? g.vendorPOs[0].vendorProduksi) : `${g.vendorPOs.length} vendor`),
    },
    { key: "qty", label: "Total Qty", default: true, align: "right", render: (g) => formatPcs(g.vendorPOs.reduce((a, p) => a + p.qty, 0)) + " pcs" },
    { key: "nilai", label: "Total Nilai", default: true, align: "right", render: (g) => formatRupiah(g.vendorPOs.reduce((a, p) => a + p.amount, 0)) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (g) => {
        const badges = g.vendorPOs.map((p) => maklonPoBadgeWithApproval(p, vendorInvoices).label);
        const allSame = badges.every((b) => b === badges[0]);
        return allSame ? <StatusPill tone={maklonPoBadgeWithApproval(g.vendorPOs[0], vendorInvoices).tone}>{badges[0]}</StatusPill> : <span className="font-sans text-[11px] text-text-muted">Campuran</span>;
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/monitoring"
      breadcrumb={["Dashboard", "Monitoring Produksi"]}
      title="Monitoring Produksi"
      subtitle={`${rows.length} MRP dengan PO vendor produksi — progres kirim & tagih lintas semua vendor`}
    >
      <DataTable
        title="MRP dengan PO vendor produksi"
        subtitle="Klik baris untuk pilih vendor, lalu lihat progres produksi per item (warna/lengan/size)"
        columns={columns}
        rows={rows}
        keyOf={(g) => g.mrpId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(g) => <span className="font-mono">{g.mrpId}</span>}
        renderExpanded={(g) => <MrpVendorDrilldown group={g} />}
        filterDefs={[{ label: "No MRP", options: Array.from(new Set(rows.map((g) => g.mrpId))), test: (g, v) => g.mrpId === v }]}
        emptyText="Belum ada PO vendor produksi yang disetujui Finance."
      />
    </AppShell>
  );
}
