"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDateTime, productionYieldAlertsList, type ProductionYieldAlertRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

export default function ProduksiYieldAlertsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const productionBatches = useMrpStore((s) => s.productionBatches);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionYieldResolutions = useMrpStore((s) => s.productionYieldResolutions);
  const resolveProductionYield = useMrpStore((s) => s.resolveProductionYield);
  const unresolveProductionYield = useMrpStore((s) => s.unresolveProductionYield);

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  if (!mounted) return null;

  const rows = productionYieldAlertsList(productionBatches, mrpDetails, productionYieldResolutions);
  const unresolvedCount = rows.filter((r) => !r.resolved).length;

  function submitResolve(batchId: string) {
    const note = (noteDraft[batchId] ?? "").trim();
    if (!note) return;
    resolveProductionYield(batchId, note);
    setNoteDraft((prev) => ({ ...prev, [batchId]: "" }));
  }

  const columns: ColumnDef<ProductionYieldAlertRow>[] = [
    { key: "vendor", label: "Vendor produksi", default: true, render: (r) => VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi },
    { key: "warna", label: "Warna / lengan", default: true, render: (r) => `${r.warna} · ${r.lengan}` },
    { key: "roll", label: "Code roll", default: true, render: (r) => <span className="font-mono">{r.codeRoll || "—"}</span> },
    {
      key: "hasil",
      label: "Hasil / target",
      default: true,
      align: "right",
      render: (r) => (
        <span className="font-mono">
          {r.actualQty} / {r.targetQty} pcs
        </span>
      ),
    },
    {
      key: "yield",
      label: "Yield",
      default: true,
      align: "right",
      render: (r) => (
        <span className="font-mono font-semibold text-danger-fg">{r.yieldPct.toFixed(1)}%</span>
      ),
    },
    { key: "cuttingAt", label: "Tanggal cutting", default: false, render: (r) => formatDateTime(r.cuttingAt) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) => <StatusPill tone={r.resolved ? "success" : "warning"}>{r.resolved ? "Sudah ditindak" : "Belum ditindak"}</StatusPill>,
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => {
        if (r.resolved) {
          const resolution = productionYieldResolutions[r.batchId];
          return (
            <div className="flex min-w-[220px] items-start justify-between gap-2">
              <span className="font-sans text-[11.5px] text-text-muted">
                {resolution?.note}
                {resolution?.resolvedAt && <span className="block font-mono text-[10px]">{formatDateTime(resolution.resolvedAt)}</span>}
              </span>
              <button onClick={() => unresolveProductionYield(r.batchId)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                Buka lagi
              </button>
            </div>
          );
        }
        return (
          <div className="flex min-w-[260px] flex-col gap-1.5">
            <input
              value={noteDraft[r.batchId] ?? ""}
              onChange={(e) => setNoteDraft((prev) => ({ ...prev, [r.batchId]: e.target.value }))}
              placeholder="Catatan (mis. alasan yield rendah / tindak lanjut)…"
              className="input text-[11.5px]"
            />
            <button
              onClick={() => submitResolve(r.batchId)}
              disabled={!(noteDraft[r.batchId] ?? "").trim()}
              className="flex-none rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Tandai ditindak
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <AppShell
      role="produksi"
      activeHref="/produksi/yield-alerts"
      breadcrumb={["Dashboard", "Yield Alert"]}
      title="Yield Alert"
      subtitle={`${rows.length} roll dengan yield di bawah baseline 99% — ${unresolvedCount} belum ditindak`}
    >
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        Daftar ini otomatis berisi roll yang sudah dicutting dengan hasil aduan aktual (diinput vendor di halaman Cutting) di bawah 99% dari target aduan pola —
        mirip konsep klaim selisih berat bahan, tapi untuk yield hasil potong, dan ditindaklanjuti dari sini (portal internal Produksi), bukan Procurement.
      </div>

      <DataTable
        title="Yield alert per roll"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.batchId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          {
            label: "Vendor produksi",
            options: Array.from(new Set(rows.map((r) => VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi))),
            test: (r, v) => (VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi) === v,
          },
          {
            label: "Status",
            options: ["Belum ditindak", "Sudah ditindak"],
            test: (r, v) => (r.resolved ? "Sudah ditindak" : "Belum ditindak") === v,
          },
        ]}
        emptyText="Belum ada roll dengan yield di bawah baseline."
      />
    </AppShell>
  );
}
