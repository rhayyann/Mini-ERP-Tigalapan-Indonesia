"use client";

import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { addDays, formatDate, invoiceBadge, receivedNotYetProducedRows } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { Lengan, RawMaterialInvoice } from "@/lib/mrp/types";

const REMARK_BY_STATUS: Record<string, string> = {
  WAITING_INVOICE: "Menunggu invoice supplier",
  INVOICED: "Menunggu payment",
  PAID: "Menunggu dikirim procurement",
  DELIVERY: "Menunggu diterima",
  RECEIVING: "Sedang diterima",
  WAITING_PRODUCTION: "Siap dipakai produksi",
  PRODUCTION_DONE: "Sudah dipakai produksi",
};

type Row = {
  key: string;
  mrpId: string;
  poId: string;
  supplier: string;
  warna: string;
  roll: number;
  rollReceiving: number;
  rollProduksi: number;
  rollSisa: number;
  status: string;
  deliveredAt?: string;
  receivedAt?: string;
  productionStart?: string;
};

function PoMaterialContent({ vendorId }: { vendorId: string }) {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);

  const myPOs = materialPOs.filter((p) => p.vendorProduksi === vendorId && p.approved && p.status !== "CANCELLED");
  const myInvoices = invoices.filter((i) => i.destinationVendor === vendorId);
  const groupRows = receivedNotYetProducedRows(vendorId, invoices, productionBatches);

  function groupFor(mrpId: string, warna: string, lengan: Lengan) {
    return groupRows.find((g) => g.mrpId === mrpId && g.warna === warna && g.lengan === lengan);
  }

  const rows: Row[] = [
    ...myPOs
      .filter((p) => p.invoicedRolls < p.rollCount)
      .map(
        (p): Row => ({
          key: "waiting-" + p.id,
          mrpId: p.mrpId,
          poId: p.id,
          supplier: p.supplier,
          warna: p.colorBreakdown.map((c) => `${c.warna} · ${c.lengan}`).join(", "),
          roll: p.rollCount - p.invoicedRolls,
          rollReceiving: 0,
          rollProduksi: 0,
          rollSisa: 0,
          status: "WAITING_INVOICE",
        })
      ),
    ...myInvoices.map((i): Row => {
      // Hanya warna yang benar-benar sudah diterima (ada roll receipt) yang ditampilkan di field Warna.
      const receivedColorEntries = i.colorEntries.filter((c) => {
        const key = c.warna + "|" + c.lengan;
        return (i.rollReceipts[key] ?? []).some((r) => r != null);
      });
      const rollReceiving = i.colorEntries.reduce((sum, c) => {
        const key = c.warna + "|" + c.lengan;
        return sum + (i.rollReceipts[key] ?? []).filter((r) => r != null).length;
      }, 0);
      const rollProduksi = receivedColorEntries.reduce((sum, c) => sum + (groupFor(i.mrpId, c.warna, c.lengan)?.used ?? 0), 0);
      const rollSisa = receivedColorEntries.reduce((sum, c) => sum + (groupFor(i.mrpId, c.warna, c.lengan)?.remaining ?? 0), 0);
      return {
        key: i.id,
        mrpId: i.mrpId,
        poId: i.poId,
        supplier: i.supplier,
        warna: receivedColorEntries.length > 0 ? receivedColorEntries.map((c) => `${c.warna} · ${c.lengan}`).join(", ") : "Menunggu diterima",
        roll: i.qtyReady,
        rollReceiving,
        rollProduksi,
        rollSisa,
        status: i.status,
        deliveredAt: i.deliveredAt,
        receivedAt: i.receivedAt,
        productionStart: i.productionStart,
      };
    }),
  ];

  // Default kolom sesuai permintaan: No. MRP (firstColumn) + Jumlah Roll, Qty Roll Receiving,
  // Qty Roll Produksi, Tanggal Delivery, Tanggal Receiving — 5 toggleable + firstColumn = 6
  // total. Sisanya (No PO, Supplier, Warna, Sisa roll, Status, Remark, tanggal lain) tetap ada,
  // cuma dipindah ke toggle "Kolom".
  const columns: ColumnDef<Row>[] = [
    { key: "noPo", label: "No PO", default: false, render: (r) => <span className="font-mono font-medium">{r.poId}</span> },
    { key: "supplier", label: "Supplier", default: false, render: (r) => r.supplier },
    { key: "warna", label: "Warna", default: false, render: (r) => r.warna },
    { key: "roll", label: "Jumlah roll", default: true, align: "right", render: (r) => r.roll + " roll" },
    { key: "rollReceiving", label: "Qty roll receiving", default: true, align: "right", render: (r) => r.rollReceiving },
    { key: "rollProduksi", label: "Qty roll produksi", default: true, align: "right", render: (r) => r.rollProduksi },
    { key: "rollSisa", label: "Sisa roll material", default: false, align: "right", render: (r) => r.rollSisa },
    {
      key: "status",
      label: "Status",
      default: false,
      render: (r) =>
        r.status === "WAITING_INVOICE" ? (
          <StatusPill tone="warning">WAITING INVOICE</StatusPill>
        ) : (
          <StatusPill tone={invoiceBadge(r.status as RawMaterialInvoice["status"]).tone}>{invoiceBadge(r.status as RawMaterialInvoice["status"]).label}</StatusPill>
        ),
    },
    { key: "remark", label: "Remark", default: false, render: (r) => REMARK_BY_STATUS[r.status] ?? "—" },
    { key: "tglDelivery", label: "Tanggal Delivery", default: true, render: (r) => formatDate(r.deliveredAt) },
    { key: "tglReceiving", label: "Tanggal Receiving", default: true, render: (r) => formatDate(r.receivedAt) },
    { key: "tglProduksi", label: "Tanggal Start Produksi", default: false, render: (r) => formatDate(r.productionStart) },
    { key: "tglDeadline", label: "Tgl Deadline", default: false, render: (r) => (r.receivedAt ? formatDate(addDays(r.receivedAt, 7)) : "—") },
    {
      key: "targetDone",
      label: "Target Done Produksi",
      default: false,
      render: (r) => (r.receivedAt ? formatDate(addDays(r.receivedAt, VENDOR_PRODUKSI[vendorId]?.productionLeadDays ?? 7)) : "—"),
    },
  ];

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/po-material"
      breadcrumb={["Dashboard", "PO Material Saya"]}
      title="PO Material Saya"
      subtitle={`${rows.length} baris material yang ditujukan ke vendor Anda, sudah disetujui Finance`}
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <DataTable
        title="PO material tujuan saya"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          { label: "No PO", options: Array.from(new Set(rows.map((r) => r.poId))), test: (r, v) => r.poId === v },
          { label: "Status", options: Array.from(new Set(rows.map((r) => r.status))), test: (r, v) => r.status === v },
        ]}
        emptyText="Belum ada PO material yang disetujui Finance untuk vendor Anda."
      />
    </AppShell>
  );
}

export default function VendorPoMaterialPage() {
  return <VendorAuthGuard>{(vendorId) => <PoMaterialContent vendorId={vendorId} />}</VendorAuthGuard>;
}
