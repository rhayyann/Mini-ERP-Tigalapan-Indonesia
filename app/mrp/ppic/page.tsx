"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { ImportDropzone } from "@/components/mrp/import-dropzone";
import { useMrpStore } from "@/lib/mrp/store";
import { mrpStatusBadges, mrpStatusBadgeTone, mrpWarnaBreakdown, effectiveMrpQty, formatPcs, formatDate, ppicApprovalBadge, vendorsForMrp } from "@/lib/mrp/derive";
import type { ParsedMrpImport } from "@/lib/mrp/parseImport";

const badgeTone = mrpStatusBadgeTone;

type ColKey = "kategori" | "qty" | "vendor" | "tglMrp" | "tglPO" | "tglApproved" | "tglInvoice" | "tglPayment" | "statusScm" | "statusPO" | "statusRM" | "statusProduksi";

const COLUMNS: { key: ColKey; label: string; default: boolean }[] = [
  { key: "kategori", label: "Kategori / Warna", default: false },
  { key: "qty", label: "Qty", default: true },
  { key: "vendor", label: "Vendor", default: false },
  { key: "tglMrp", label: "Tanggal MRP", default: false },
  { key: "tglPO", label: "Tanggal PO", default: false },
  { key: "tglApproved", label: "Tanggal PO Disetujui", default: false },
  { key: "tglInvoice", label: "Tanggal Invoice", default: false },
  { key: "tglPayment", label: "Tanggal Payment", default: false },
  { key: "statusScm", label: "Status SCM", default: true },
  { key: "statusPO", label: "Status PO", default: true },
  { key: "statusRM", label: "Status Raw Material", default: true },
  { key: "statusProduksi", label: "Status Produksi", default: true },
];

export default function MrpListPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const importMrp = useMrpStore((s) => s.importMrp);

  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(COLUMNS.filter((c) => c.default).map((c) => c.key)));
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [filterVendor, setFilterVendor] = useState("");
  const [filterStatusPO, setFilterStatusPO] = useState("");
  const [filterStatusRM, setFilterStatusRM] = useState("");
  const [filterStatusProd, setFilterStatusProd] = useState("");
  // Klik baris untuk expand/collapse rincian warna (qty/roll/rib panjang·pendek·total) — bisa
  // lebih dari satu baris terbuka sekaligus, makanya Set bukan satu id tunggal.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleCol(key: ColKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleExpanded(mrpId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mrpId)) next.delete(mrpId);
      else next.add(mrpId);
      return next;
    });
  }

  const rows = useMemo(() => {
    const all: { mrp: (typeof mrpDetails)[number]["mrp"]; detail?: (typeof mrpDetails)[number] }[] = [
      ...mrpDetails.map((d) => ({ mrp: d.mrp, detail: d })),
      ...staticMrps.map((m) => ({ mrp: m })),
    ];
    return all.map(({ mrp, detail }) => ({
      mrp,
      detail,
      // MRP bisa punya lebih dari 1 warna sekaligus (tiap warna = 1 lenganGroup dari file
      // import) — mrp.warna cuma menyimpan warna pertama sebagai label ringkas, jadi di sini
      // kumpulkan semua warna unik dari lenganGroups supaya tidak "hilang" di tabel ringkasan.
      warnaLabel: detail && detail.lenganGroups.length > 0 ? Array.from(new Set(detail.lenganGroups.map((g) => g.warna))).join(", ") : mrp.warna,
      badges: mrpStatusBadges(mrp.id, detail, materialPOs, maklonPOs, invoices, vendorInvoices),
      vendors: vendorsForMrp(detail),
    }));
  }, [mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, vendorInvoices]);

  if (!mounted) return null;

  function handleConfirm(parsed: ParsedMrpImport, customId?: string) {
    importMrp(parsed, customId);
  }

  const allVendors = Array.from(new Set(rows.flatMap((r) => r.vendors))).sort();
  const allStatusPO = Array.from(new Set(rows.map((r) => r.badges.statusPO)));
  const allStatusRM = Array.from(new Set(rows.map((r) => r.badges.statusRawMaterial)));
  const allStatusProd = Array.from(new Set(rows.map((r) => r.badges.statusProduksi)));

  const filteredRows = rows.filter(
    (r) =>
      (!filterVendor || r.vendors.includes(filterVendor)) &&
      (!filterStatusPO || r.badges.statusPO === filterStatusPO) &&
      (!filterStatusRM || r.badges.statusRawMaterial === filterStatusRM) &&
      (!filterStatusProd || r.badges.statusProduksi === filterStatusProd)
  );

  // +1 untuk kolom No. MRP yang selalu tampil (tidak lewat toggle "Kolom") — dipakai sebagai
  // colSpan baris rincian expand & baris "tidak ada hasil" supaya selalu selebar tabel yang benar
  // (+1 No. MRP di awal, +1 kolom chevron expand di akhir — keduanya selalu tampil, di luar toggle).
  const totalCols = 2 + COLUMNS.filter((c) => visibleCols.has(c.key)).length;

  return (
    <AppShell role="ppic" activeHref="/mrp/ppic" breadcrumb={["Dashboard", "Material Requirement Planning"]} title="Material Requirement Planning">
      <ImportDropzone onConfirm={handleConfirm} />

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3.5">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Material Requirement Planning</span>
          <div className="relative ml-auto">
            <button
              onClick={() => setColPickerOpen((v) => !v)}
              className="rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary"
            >
              ⊞ Kolom
            </button>
            {colPickerOpen && (
              <div className="absolute right-0 top-[110%] z-20 w-56 rounded-md border border-border-subtle bg-surface-card p-2 shadow-[0_8px_20px_rgba(11,19,27,.15)]">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 font-sans text-xs text-[#31414F] hover:bg-[#F7F9FB]">
                    <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleCol(c.key)} className="h-3.5 w-3.5 accent-accent-blue" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Link href="/mrp/ppic/new" className="rounded-[5px] bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">
            Input manual
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
          <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Vendor: Semua</option>
            {allVendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={filterStatusPO} onChange={(e) => setFilterStatusPO(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Status PO: Semua</option>
            {allStatusPO.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={filterStatusRM} onChange={(e) => setFilterStatusRM(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Status Raw Material: Semua</option>
            {allStatusRM.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={filterStatusProd} onChange={(e) => setFilterStatusProd(e.target.value)} className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]">
            <option value="">Status Produksi: Semua</option>
            {allStatusProd.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-accent-blue bg-info-bg font-sans text-[10.5px] font-medium uppercase tracking-wider text-info-fg">
                <th className="px-5 py-[9px] text-left">No. MRP</th>
                {visibleCols.has("kategori") && <th className="px-3 py-[9px] text-left">Kategori / Warna</th>}
                {visibleCols.has("qty") && <th className="px-3 py-[9px] text-right">Qty</th>}
                {visibleCols.has("vendor") && <th className="px-3 py-[9px] text-left">Vendor</th>}
                {visibleCols.has("tglMrp") && <th className="px-3 py-[9px] text-left">Tanggal MRP</th>}
                {visibleCols.has("tglPO") && <th className="px-3 py-[9px] text-left">Tanggal PO</th>}
                {visibleCols.has("tglApproved") && <th className="px-3 py-[9px] text-left">Tanggal PO Disetujui</th>}
                {visibleCols.has("tglInvoice") && <th className="px-3 py-[9px] text-left">Tanggal Invoice</th>}
                {visibleCols.has("tglPayment") && <th className="px-3 py-[9px] text-left">Tanggal Payment</th>}
                {visibleCols.has("statusScm") && <th className="px-3 py-[9px] text-left">Status SCM</th>}
                {visibleCols.has("statusPO") && <th className="px-3 py-[9px] text-left">Status PO</th>}
                {visibleCols.has("statusRM") && <th className="px-3 py-[9px] text-left">Status Raw Material</th>}
                {visibleCols.has("statusProduksi") && <th className="px-5 py-[9px] text-left">Status Produksi</th>}
                <th className="w-8 px-3 py-[9px]" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ mrp, detail, warnaLabel, badges, vendors }) => {
                const isExpanded = expandedIds.has(mrp.id);
                const breakdown = mrpWarnaBreakdown(detail);
                return (
                  <Fragment key={mrp.id}>
                    <tr
                      onClick={() => toggleExpanded(mrp.id)}
                      className="cursor-pointer border-b border-[#F1F4F7] font-sans text-xs text-[#31414F] last:border-b-0 hover:bg-[#FAFBFC]"
                      title="Klik untuk lihat rincian warna (qty/roll/rib panjang · pendek · total)"
                    >
                      <td className="px-5 py-[13px] font-mono font-medium">{mrp.id}</td>
                      {visibleCols.has("kategori") && (
                        <td className="px-3 py-[13px]">
                          {mrp.kategori} · {warnaLabel}
                        </td>
                      )}
                      {visibleCols.has("qty") && <td className="px-3 py-[13px] text-right font-mono">{formatPcs(effectiveMrpQty(mrp.id, mrp.qty, maklonPOs))}</td>}
                      {visibleCols.has("vendor") && <td className="px-3 py-[13px]">{vendors.length ? vendors.join(", ") : "—"}</td>}
                      {visibleCols.has("tglMrp") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.created)}</td>}
                      {visibleCols.has("tglPO") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.poSent)}</td>}
                      {visibleCols.has("tglApproved") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.poApproved)}</td>}
                      {visibleCols.has("tglInvoice") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.firstInvoice)}</td>}
                      {visibleCols.has("tglPayment") && <td className="px-3 py-[13px] font-mono">{formatDate(detail?.dates?.firstPayment)}</td>}
                      {visibleCols.has("statusScm") && (
                        <td className="px-3 py-[13px]">
                          {detail ? (
                            <StatusPill tone={ppicApprovalBadge(detail.ppicApproval).tone}>{ppicApprovalBadge(detail.ppicApproval).label}</StatusPill>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      {visibleCols.has("statusPO") && (
                        <td className="px-3 py-[13px]">
                          <StatusPill tone={badgeTone(badges.statusPO)}>{badges.statusPO}</StatusPill>
                        </td>
                      )}
                      {visibleCols.has("statusRM") && (
                        <td className="px-3 py-[13px]">
                          <StatusPill tone={badgeTone(badges.statusRawMaterial)}>{badges.statusRawMaterial}</StatusPill>
                        </td>
                      )}
                      {visibleCols.has("statusProduksi") && (
                        <td className="px-5 py-[13px]">
                          <StatusPill tone={badgeTone(badges.statusProduksi)}>{badges.statusProduksi}</StatusPill>
                        </td>
                      )}
                      <td className="px-3 py-[13px]">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[#F1F4F7] last:border-b-0">
                        <td colSpan={totalCols} className="bg-[#FAFBFC] px-5 py-4">
                          {detail?.ppicApproval === "REJECTED" && (
                            <div className="mb-3 rounded-md border border-[#EFC9C4] bg-danger-bg px-3.5 py-2.5 font-sans text-[11.5px] leading-[1.5] text-danger-fg">
                              <span className="font-semibold">Ditolak SCM</span>
                              {detail.ppicRejectionNote ? ` — ${detail.ppicRejectionNote}` : ""} — impor ulang dengan data yang sudah dibetulkan kalau perlu diajukan lagi.
                            </div>
                          )}
                          {breakdown.length === 0 ? (
                            <div className="font-sans text-[11.5px] text-text-muted">
                              Belum ada rincian warna/lengan untuk MRP ini (data lama atau tanpa detail import).
                            </div>
                          ) : (
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
                                      <td className="border-l border-[#F1F4F7] px-3 py-2 text-right font-mono">
                                        {w.ribPanjang.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono">{w.ribPendek.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
                                      <td className="px-3 py-2 text-right font-mono font-semibold">
                                        {w.ribTotal.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                  {breakdown.length > 1 && (
                                    <tr className="border-t-2 border-accent-blue bg-info-bg font-sans text-[11.5px] font-semibold text-info-fg">
                                      <td className="px-3 py-2">Total semua warna</td>
                                      <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                                        {formatPcs(breakdown.reduce((s, w) => s + w.qtyPanjang, 0))}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyPendek, 0))}</td>
                                      <td className="px-3 py-2 text-right font-mono">{formatPcs(breakdown.reduce((s, w) => s + w.qtyTotal, 0))}</td>
                                      <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                                        {breakdown.reduce((s, w) => s + w.rollPanjang, 0).toLocaleString("id-ID")}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollPendek, 0).toLocaleString("id-ID")}</td>
                                      <td className="px-3 py-2 text-right font-mono">{breakdown.reduce((s, w) => s + w.rollTotal, 0).toLocaleString("id-ID")}</td>
                                      <td className="border-l border-accent-blue/20 px-3 py-2 text-right font-mono">
                                        {breakdown.reduce((s, w) => s + w.ribPanjang, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono">
                                        {breakdown.reduce((s, w) => s + w.ribPendek, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono">
                                        {breakdown.reduce((s, w) => s + w.ribTotal, 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={totalCols} className="px-5 py-6 text-center font-sans text-xs text-text-muted">
                    Tidak ada MRP yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
