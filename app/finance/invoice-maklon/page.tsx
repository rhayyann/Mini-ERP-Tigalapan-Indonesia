"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, maklonInvoiceBadge } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonInvoice } from "@/lib/mrp/types";

export default function InvoiceMaklonPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const approveMaklonInvoice = useMrpStore((s) => s.approveMaklonInvoice);
  const payMaklonInvoice = useMrpStore((s) => s.payMaklonInvoice);

  if (!mounted) return null;

  const pending = maklonInvoices.filter((i) => i.status === "SUBMITTED");

  const columns: ColumnDef<MaklonInvoice>[] = [
    { key: "poId", label: "No PO Produksi", default: true, render: (i) => <span className="font-mono font-medium">{i.maklonPoId}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (i) => VENDOR_PRODUKSI[i.vendorProduksi]?.name ?? i.vendorProduksi },
    { key: "base", label: "Base fee", default: true, align: "right", render: (i) => formatRupiah(i.baseFee) },
    { key: "penalty", label: "Penalty", default: false, align: "right", render: (i) => (i.penalty ? "−" + formatRupiah(i.penalty) : "—") },
    { key: "bonus", label: "Bonus", default: false, align: "right", render: (i) => (i.bonus ? "+" + formatRupiah(i.bonus) : "—") },
    { key: "retention", label: "Retention", default: false, align: "right", render: (i) => (i.retentionPct ? i.retentionPct + "%" : "—") },
    { key: "net", label: "Net dibayar", default: true, align: "right", render: (i) => formatRupiah(i.netAmount) },
    { key: "entitas", label: "Entitas", default: false, render: (i) => i.entity },
    { key: "note", label: "Catatan vendor", default: false, render: (i) => i.note || "—" },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={maklonInvoiceBadge(i.status).tone}>{maklonInvoiceBadge(i.status).label}</StatusPill> },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (i) =>
        i.status === "SUBMITTED" ? (
          <Button onClick={() => approveMaklonInvoice(i.id)} variant="success" size="xs">
            Approve
          </Button>
        ) : i.status === "APPROVED" ? (
          <Button onClick={() => payMaklonInvoice(i.id)} variant="success" size="xs">
            Bayar
          </Button>
        ) : (
          <span className="font-sans text-[11.5px] font-medium text-[#94A3B0]">Dibayar</span>
        ),
    },
  ];

  return (
    <AppShell
      role="finance"
      activeHref="/finance/invoice-maklon"
      breadcrumb={["Dashboard", "Invoice Maklon"]}
      title="Invoice Maklon (Arsip)"
      subtitle={pending.length ? `${pending.length} invoice maklon lama menunggu approval` : "Tidak ada invoice maklon menunggu approval"}
      notifCount={pending.length}
    >
      <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
        Jalur ini <b>sudah tidak menerima pengajuan baru</b> dari vendor (konsolidasi ke Invoice Vendor per-pcs, direview Procurement +
        bisa dicicil pembayarannya). Tabel di bawah cuma invoice lama yang sudah pernah diajukan sebelum penutupan — tetap perlu
        diselesaikan: Approve → Bayar akan menandai PO produksi FULLY PAID.
      </div>
      <DataTable
        title="Semua invoice maklon (arsip)"
        columns={columns}
        rows={maklonInvoices}
        keyOf={(i) => i.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(i) => <span className="font-mono">{i.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(maklonInvoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "No PO Produksi", options: Array.from(new Set(maklonInvoices.map((i) => i.maklonPoId))), test: (i, v) => i.maklonPoId === v },
          { label: "Status", options: Array.from(new Set(maklonInvoices.map((i) => i.status))), test: (i, v) => i.status === v },
        ]}
        emptyText="Belum pernah ada invoice maklon yang diajukan sebelum jalur ini ditutup."
      />
    </AppShell>
  );
}
