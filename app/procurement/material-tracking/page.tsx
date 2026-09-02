"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { TransferMaterialModal, type TransferCandidate } from "@/components/mrp/transfer-material-modal";
import { SetDeliveryModal } from "@/components/mrp/set-delivery-modal";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatRupiah, materialPoFullStatus, materialPoFullStatusBadge, mrpDetailFor, rollArrivalProgress, type MaterialPoFullStatus } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { RawMaterialInvoice } from "@/lib/mrp/types";

type TrackingRow = {
  id: string;
  kind: "invoice" | "pending";
  mrpId: string;
  poId: string;
  supplierVendor: string;
  roll: number;
  nilai: number | null;
  warna: string;
  entitas: string;
  kodeTransaksi?: string;
  tglMrp?: string;
  tglInvoice?: string;
  tglPayment?: string;
  tglDelivery?: string;
  tglReceiving?: string;
  tglProduksi?: string;
  status: MaterialPoFullStatus;
  invoice?: RawMaterialInvoice;
};

export default function MaterialTrackingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const setInvoicesDelivery = useMrpStore((s) => s.setInvoicesDelivery);
  const transferMaterial = useMrpStore((s) => s.transferMaterial);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  if (!mounted) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const invoiceRows: TrackingRow[] = invoices.map((i) => {
    const po = materialPOs.find((p) => p.id === i.poId);
    return {
      id: i.id,
      kind: "invoice",
      mrpId: i.mrpId,
      poId: i.poId,
      supplierVendor: `${i.supplier} → ${VENDOR_PRODUKSI[i.destinationVendor]?.name ?? i.destinationVendor}`,
      roll: i.qtyReady,
      nilai: i.totalBiaya,
      warna: i.colorEntries.map((c) => c.warna).join(", ") || "—",
      entitas: i.entity,
      kodeTransaksi: i.kodeTransaksi,
      tglMrp: mrpDetailFor(i.mrpId, mrpDetails)?.dates.created,
      tglInvoice: i.bookedAt,
      tglPayment: i.paidAt,
      tglDelivery: i.deliveredAt,
      tglReceiving: i.receivedAt,
      tglProduksi: i.productionStart,
      status: po ? materialPoFullStatus(po, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices) : "INVOICE",
      invoice: i,
    };
  });

  // Material Tracking sekarang KHUSUS material yang sudah dibayar (Finance) ke atas —
  // "belum dibayar" (materialPO yang belum diinvoice sama sekali, ATAU invoice yang sudah
  // dibuat tapi statusnya masih INVOICED/belum PAID) sengaja tidak ditampilkan di sini, supaya
  // halaman ini fokus ke tracking fisik material yang sudah pasti jadi (dibayar), bukan yang
  // masih dalam proses invoice/approval. Baris "pending" (materialPO belum diinvoice) yang
  // sebelumnya ikut ditampilkan sudah dihapus dari sini.
  const rows: TrackingRow[] = invoiceRows.filter((r) => r.invoice && r.invoice.status !== "INVOICED");

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedInvoiceOnly = selectedRows.filter((r) => r.kind === "invoice" && r.invoice).map((r) => r.invoice!);
  const selectedPaidList = selectedInvoiceOnly.filter((i) => i.status === "PAID");

  // Dibatasi ke 6 kolom default (+ No. MRP di firstColumn = 7 total) — sebelumnya 10 kolom
  // sekaligus nyala bikin tabel penuh & baris jadi bertumpuk-tumpuk (3 kolom tanggal terpisah,
  // dsb). Sisanya tetap bisa dinyalakan lewat "Kolom" kalau perlu audit detail per tanggal.
  const columns: ColumnDef<TrackingRow>[] = [
    { key: "noPo", label: "No PO", default: true, render: (r) => <span className="font-mono font-medium">{r.poId}</span> },
    { key: "supplierVendor", label: "Supplier → Vendor", default: true, render: (r) => r.supplierVendor },
    { key: "roll", label: "Roll", default: true, align: "right", render: (r) => r.roll },
    {
      key: "rollDiterima",
      label: "Roll Diterima",
      default: false,
      align: "right",
      render: (r) => {
        if (!r.invoice) return "—";
        const p = rollArrivalProgress(r.invoice);
        return p.total > 0 ? `${p.arrived}/${p.total}` : "—";
      },
    },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (r) => (r.nilai != null ? formatRupiah(r.nilai) : "—") },
    { key: "warna", label: "Warna", default: true, render: (r) => r.warna },
    { key: "entitas", label: "Entitas", default: false, render: (r) => r.entitas },
    { key: "kodeTransaksi", label: "Kode Transaksi", default: false, render: (r) => <span className="font-mono">{r.kodeTransaksi ?? "—"}</span> },
    { key: "tglMrp", label: "Tanggal MRP", default: false, render: (r) => formatDate(r.tglMrp) },
    { key: "tglInvoice", label: "Tanggal Invoice", default: false, render: (r) => formatDate(r.tglInvoice) },
    { key: "tglPayment", label: "Tanggal Payment", default: false, render: (r) => formatDate(r.tglPayment) },
    { key: "tglDelivery", label: "Tanggal Delivery", default: false, render: (r) => formatDate(r.tglDelivery) },
    { key: "tglReceiving", label: "Tanggal Receiving", default: false, render: (r) => formatDate(r.tglReceiving) },
    { key: "tglProduksi", label: "Tanggal Proses Produksi", default: false, render: (r) => formatDate(r.tglProduksi) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) => <StatusPill tone={materialPoFullStatusBadge(r.status).tone}>{materialPoFullStatusBadge(r.status).label}</StatusPill>,
    },
  ];

  return (
    <AppShell
      role="procurement"
      activeHref="/procurement/material-tracking"
      breadcrumb={["Dashboard", "Material Tracking"]}
      title="Material tracking"
      subtitle={`${rows.length} baris material — invoice yang sudah dibayar Finance ke atas`}
    >
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
          <div className="ml-1 flex gap-2">
            {selectedPaidList.length > 0 && (
              <button onClick={() => setDeliveryOpen(true)} className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[5px] font-sans text-[11.5px] font-semibold text-action-primary">
                Set Delivery ({selectedPaidList.length})
              </button>
            )}
            {selectedInvoiceOnly.length > 0 && (
              <button onClick={() => setTransferOpen(true)} className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[5px] font-sans text-[11.5px] font-semibold text-action-primary">
                Pindahkan {selectedInvoiceOnly.length} ke vendor lain
              </button>
            )}
          </div>
        </div>
      )}

      <DataTable
        title="Material per line"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => (
          <span className="flex items-center gap-2.5">
            <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            <span className="font-mono">{r.mrpId}</span>
          </span>
        )}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          { label: "No PO", options: Array.from(new Set(rows.map((r) => r.poId))), test: (r, v) => r.poId === v },
          { label: "Entitas", options: Array.from(new Set(rows.map((r) => r.entitas))), test: (r, v) => r.entitas === v },
          {
            label: "Status",
            options: Array.from(new Set(rows.map((r) => materialPoFullStatusBadge(r.status).label))),
            test: (r, v) => materialPoFullStatusBadge(r.status).label === v,
          },
        ]}
        emptyText="Belum ada invoice material yang sudah dibayar Finance."
      />

      {deliveryOpen && (
        <SetDeliveryModal
          count={selectedPaidList.length}
          onCancel={() => setDeliveryOpen(false)}
          onConfirm={(deliveryDate) => {
            setInvoicesDelivery(selectedPaidList.map((i) => i.id), deliveryDate);
            setSelected(new Set());
            setDeliveryOpen(false);
          }}
        />
      )}

      {transferOpen && (
        <TransferMaterialModal
          items={selectedInvoiceOnly.map(
            (i): TransferCandidate => ({ id: i.id, mrpId: i.mrpId, poId: i.poId, warna: i.colorEntries.map((c) => c.warna).join(", ") || "—", qtyReady: i.qtyReady })
          )}
          vendors={Object.keys(VENDOR_PRODUKSI).map((v) => ({ id: v, name: VENDOR_PRODUKSI[v].name }))}
          onCancel={() => setTransferOpen(false)}
          onConfirm={(toVendor, qtyByInvoice, deliveryDate) => {
            const items = Object.entries(qtyByInvoice)
              .filter(([, qty]) => qty > 0)
              .map(([invoiceId, qty]) => ({ invoiceId, qty }));
            transferMaterial(items, toVendor, deliveryDate);
            setSelected(new Set());
            setTransferOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}
