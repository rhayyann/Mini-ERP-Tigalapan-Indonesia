"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { useMrpStore } from "@/lib/mrp/store";
import { effectiveMrpQty, formatPcs, mrpStatusBadges, mrpStatusBadgeTone, mrpWarnaBreakdown, ppicApprovalBadge, vendorsForMrp } from "@/lib/mrp/derive";
import type { Mrp } from "@/lib/mrp/types";
import type { MrpDetail } from "@/lib/mrp/store";

type Row = {
  mrp: Mrp;
  detail?: MrpDetail;
  vendors: string[];
  badges: ReturnType<typeof mrpStatusBadges>;
};

export default function ScmMonitoringPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  const rows: Row[] = useMemo(() => {
    const all: { mrp: Mrp; detail?: MrpDetail }[] = [...mrpDetails.map((d) => ({ mrp: d.mrp, detail: d })), ...staticMrps.map((m) => ({ mrp: m }))];
    return all.map(({ mrp, detail }) => ({
      mrp,
      detail,
      vendors: vendorsForMrp(detail),
      badges: mrpStatusBadges(mrp.id, detail, materialPOs, maklonPOs, invoices, vendorInvoices),
    }));
  }, [mrpDetails, staticMrps, materialPOs, maklonPOs, invoices, vendorInvoices]);

  if (!mounted) return null;

  const columns: ColumnDef<Row>[] = [
    { key: "kategori", label: "Kategori / Warna", default: true, render: (r) => `${r.mrp.kategori} · ${r.mrp.warna}` },
    { key: "qty", label: "Qty", default: true, align: "right", render: (r) => formatPcs(effectiveMrpQty(r.mrp.id, r.mrp.qty, maklonPOs)) + " pcs" },
    { key: "vendor", label: "Vendor", default: true, render: (r) => (r.vendors.length ? r.vendors.join(", ") : "—") },
    {
      key: "statusScm",
      label: "Status SCM",
      default: true,
      render: (r) => (r.detail ? <StatusPill tone={ppicApprovalBadge(r.detail.ppicApproval).tone}>{ppicApprovalBadge(r.detail.ppicApproval).label}</StatusPill> : "—"),
    },
    {
      key: "statusPO",
      label: "Status PO",
      default: true,
      render: (r) => <StatusPill tone={mrpStatusBadgeTone(r.badges.statusPO)}>{r.badges.statusPO}</StatusPill>,
    },
    {
      key: "statusRM",
      label: "Status Raw Material",
      default: true,
      render: (r) => <StatusPill tone={mrpStatusBadgeTone(r.badges.statusRawMaterial)}>{r.badges.statusRawMaterial}</StatusPill>,
    },
    {
      key: "statusProduksi",
      label: "Status Produksi",
      default: true,
      render: (r) => <StatusPill tone={mrpStatusBadgeTone(r.badges.statusProduksi)}>{r.badges.statusProduksi}</StatusPill>,
    },
  ];

  return (
    <AppShell
      role="scm"
      activeHref="/scm/monitoring"
      breadcrumb={["Dashboard", "Monitoring"]}
      title="Monitoring lintas modul"
      subtitle={`${rows.length} MRP — status approval, PO, raw material, dan produksi dalam satu tampilan`}
    >
      <DataTable
        title="Semua MRP"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrp.id}</span>}
        renderExpanded={(r) => <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(r.detail)} />}
        filterDefs={[
          { label: "Vendor", options: Array.from(new Set(rows.flatMap((r) => r.vendors))).sort(), test: (r, v) => r.vendors.includes(v) },
          {
            label: "Status SCM",
            options: Array.from(new Set(rows.filter((r) => r.detail).map((r) => ppicApprovalBadge(r.detail!.ppicApproval).label))),
            test: (r, v) => !!r.detail && ppicApprovalBadge(r.detail.ppicApproval).label === v,
          },
          { label: "Status PO", options: Array.from(new Set(rows.map((r) => r.badges.statusPO))), test: (r, v) => r.badges.statusPO === v },
          { label: "Status Raw Material", options: Array.from(new Set(rows.map((r) => r.badges.statusRawMaterial))), test: (r, v) => r.badges.statusRawMaterial === v },
          { label: "Status Produksi", options: Array.from(new Set(rows.map((r) => r.badges.statusProduksi))), test: (r, v) => r.badges.statusProduksi === v },
        ]}
        emptyText="Belum ada MRP yang tercatat."
      />
    </AppShell>
  );
}
