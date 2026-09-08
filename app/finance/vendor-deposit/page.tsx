"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDateTime, formatRupiah, vendorDepositBalance, vendorDepositEntriesFor, vendorDepositSuppliers } from "@/lib/mrp/derive";
// Item 6 (feedback batch 2026-09-07): bukti transfer & bukti foto klaim sengaja tidak ada di
// snapshot (payload PDF/foto besar) -- fetch on-demand saat tombol diklik, pola SAMA seperti
// payment-panel.tsx (viewPaymentProof) & material-claims/page.tsx (viewClaimPhoto).
import { getInvoicePaymentProofAction, getMaterialClaimPhotoAction } from "@/lib/mrp/actions";
// Revisi 2026-09-08 (bug fix popup blocked): openPreviewWindow/fillPreviewWindow -- lihat
// catatan panjang di lib/mrp/clientFiles.ts.
import { viewAndDownloadFile, openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";
import type { RawMaterialInvoice, VendorDepositEntry } from "@/lib/mrp/types";

/** `sourceClaimId` disimpan dgn format yang sama seperti key klaim di seluruh app
 *  ("invoiceId|warna|lengan|rollIndex", lihat parseClaimKey di lib/mrp/actions.ts -- tidak bisa
 *  diimpor langsung dari situ karena file itu "use server") -- dipakai untuk cari invoice ASLI
 *  yang diklaim & kode roll roll itu. */
function parseSourceClaimId(key: string): { invoiceId: string; warna: string; lengan: string; rollIndex: number } | null {
  const parts = key.split("|");
  if (parts.length !== 4) return null;
  const [invoiceId, warna, lengan, rollIndexStr] = parts;
  const rollIndex = parseInt(rollIndexStr, 10);
  if (Number.isNaN(rollIndex)) return null;
  return { invoiceId, warna, lengan, rollIndex };
}

/** Invoice + roll yang relevan untuk 1 baris ledger deposit -- dipakai untuk isi kolom No MRP/No
 *  PO/Kode Roll & 3 tombol bukti. Untuk CREDIT: invoice ASLI yang diklaim (dari sourceClaimId).
 *  Untuk DEBIT: invoice yang DIBAYAR pakai saldo ini (dari sourceInvoiceId) -- tidak ada roll
 *  spesifik (mengurangi tagihan invoice, bukan 1 roll), jadi Kode Roll & bukti klaim "—". */
function relevantContextFor(e: VendorDepositEntry, invoices: RawMaterialInvoice[]) {
  if (e.kind === "CREDIT" && e.sourceClaimId) {
    const parsed = parseSourceClaimId(e.sourceClaimId);
    const invoice = parsed ? invoices.find((i) => i.id === parsed.invoiceId) : undefined;
    const colorKey = parsed ? `${parsed.warna}|${parsed.lengan}` : "";
    const codeRoll = parsed && invoice ? (invoice.rollArrivals[colorKey]?.[parsed.rollIndex]?.codeRoll ?? invoice.rollReceipts[colorKey]?.[parsed.rollIndex]?.codeRoll) : undefined;
    return { invoice, codeRoll, claimKey: e.sourceClaimId, transferInvoiceId: invoice?.id };
  }
  if (e.kind === "DEBIT" && e.sourceInvoiceId) {
    const invoice = invoices.find((i) => i.id === e.sourceInvoiceId);
    return { invoice, codeRoll: undefined, claimKey: undefined, transferInvoiceId: invoice?.id };
  }
  return { invoice: undefined, codeRoll: undefined, claimKey: undefined, transferInvoiceId: undefined };
}

async function viewBuktiTransfer(invoiceId: string) {
  const win = openPreviewWindow();
  try {
    const proof = await getInvoicePaymentProofAction(invoiceId);
    if (!proof) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, proof.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

async function viewBuktiKlaim(claimKey: string) {
  const win = openPreviewWindow();
  try {
    const photo = await getMaterialClaimPhotoAction(claimKey);
    if (!photo) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, photo.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

type SupplierDepositRow = { supplier: string; balance: number; entryCount: number };

/** Revisi 2026-09-06: halaman "Saldo Deposit Vendor" -- transparansi (lihat seluruh ledger CREDIT/
 *  DEBIT per supplier: dari klaim mana / dipakai bayar invoice apa, kapan, berapa) supaya saldo
 *  tidak pernah jadi angka blackbox.
 *
 *  Revisi 2026-09-07: tadinya murni read-only -- ditambah tombol "Hapus" per baris ledger supaya
 *  Finance bisa membersihkan baris yang keliru/yatim TANPA reset seluruh aplikasi. Kasus nyata yang
 *  memicu ini: `resetAllAction` ("Reset Data") dulu tidak ikut menghapus tabel vendor_deposits
 *  (standalone, tidak beracuan FK ke mrp) -- sudah dibetulkan di actions.ts, tapi baris LAMA yang
 *  sudah terlanjur "yatim" (menunjuk klaim/invoice yang sudah tidak ada) dari sebelum perbaikan itu
 *  butuh cara dibersihkan manual. */
export default function VendorDepositPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const vendorDeposits = useMrpStore((s) => s.vendorDeposits);
  const deleteVendorDepositEntry = useMrpStore((s) => s.deleteVendorDepositEntry);
  const invoices = useMrpStore((s) => s.invoices);

  if (!mounted) return null;

  function confirmDelete(id: string, label: string) {
    if (window.confirm(`Hapus permanen baris "${label}"? Saldo berjalan supplier ini akan otomatis terkoreksi. Tindakan ini tidak bisa dibatalkan.`)) {
      deleteVendorDepositEntry(id);
    }
  }

  const suppliers = vendorDepositSuppliers(vendorDeposits);
  const rows: SupplierDepositRow[] = suppliers.map((supplier) => ({
    supplier,
    balance: vendorDepositBalance(supplier, vendorDeposits),
    entryCount: vendorDepositEntriesFor(supplier, vendorDeposits).length,
  }));
  const totalBalance = rows.reduce((a, r) => a + r.balance, 0);

  const columns: ColumnDef<SupplierDepositRow>[] = [
    { key: "entryCount", label: "Jumlah Transaksi", default: true, align: "right", render: (r) => r.entryCount },
    {
      key: "balance",
      label: "Saldo Berjalan",
      default: true,
      align: "right",
      render: (r) => (
        <span className={"font-mono font-semibold " + (r.balance > 0 ? "text-success-fg" : "text-text-muted")}>{formatRupiah(r.balance)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) => (r.balance > 0 ? <StatusPill tone="success">Ada saldo</StatusPill> : <StatusPill tone="neutral">Habis terpakai</StatusPill>),
    },
  ];

  return (
    <AppShell
      role="finance"
      activeHref="/finance/vendor-deposit"
      breadcrumb={["Dashboard", "Saldo Deposit Vendor"]}
      title="Saldo Deposit Vendor"
      subtitle={`${rows.length} supplier tercatat — total saldo berjalan ${formatRupiah(totalBalance)}`}
    >
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        Saldo di sini berasal dari klaim selisih berat yang diselesaikan Procurement lewat &quot;retur + pesan ulang&quot; (lihat halaman Klaim Material) --
        nilai retur roll lama dicatat sebagai kredit, lepas dari PV pengganti mana pun. Saldo ini bisa dipakai untuk mengurangi pembayaran invoice APA PUN ke
        supplier yang sama, dipilih manual dari halaman Payment. Klik baris untuk lihat rincian setiap transaksi (kredit masuk / dipakai bayar).
      </div>

      <DataTable
        title="Saldo per supplier"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.supplier}
        firstColumnLabel="Supplier"
        firstColumnRender={(r) => <span className="font-medium">{r.supplier}</span>}
        emptyText="Belum ada saldo deposit vendor tercatat."
        renderExpanded={(r) => {
          const entries = vendorDepositEntriesFor(r.supplier, vendorDeposits);
          const gridCols = "minmax(90px,0.8fr) minmax(90px,0.8fr) minmax(70px,0.6fr) minmax(70px,0.6fr) minmax(100px,0.9fr) minmax(90px,0.8fr) minmax(160px,1.4fr) minmax(60px,0.5fr)";
          return (
            <div className="overflow-x-auto rounded-md border border-[#E4E8EE] bg-white">
              <div
                className="grid min-w-[900px] gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted"
                style={{ gridTemplateColumns: gridCols }}
              >
                <span>Tanggal</span>
                <span>Jenis</span>
                <span>No MRP</span>
                <span>No PO</span>
                <span>Kode Roll</span>
                <span className="text-right">Nilai</span>
                <span>Bukti</span>
                <span className="text-right">Aksi</span>
              </div>
              {entries.map((e) => {
                const label = e.kind === "CREDIT" ? "Kredit masuk" : "Dipakai bayar";
                const ctx = relevantContextFor(e, invoices);
                return (
                  <div key={e.id} className="grid min-w-[900px] items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]" style={{ gridTemplateColumns: gridCols }}>
                    <span className="font-mono text-[10.5px]">{formatDateTime(e.createdAt)}</span>
                    <span>
                      <StatusPill tone={e.kind === "CREDIT" ? "success" : "warning"}>{label}</StatusPill>
                    </span>
                    <span className="font-mono text-[10.5px]">{ctx.invoice?.mrpId ?? "—"}</span>
                    <span className="font-mono text-[10.5px]">{ctx.invoice?.poId ?? "—"}</span>
                    <span className="font-mono text-[10.5px]">
                      {ctx.codeRoll ?? "—"}
                      {e.note ? <span className="ml-1 font-sans text-text-muted">— {e.note}</span> : null}
                    </span>
                    <span className={"text-right font-mono font-medium " + (e.kind === "CREDIT" ? "text-success-fg" : "text-danger-fg")}>
                      {e.kind === "CREDIT" ? "+" : "−"}
                      {formatRupiah(e.amount)}
                    </span>
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {ctx.invoice?.buktiPvDataUrl ? (
                        <button
                          onClick={() => viewAndDownloadFile(ctx.invoice!.buktiPvDataUrl!)}
                          className="font-sans text-[10.5px] font-semibold text-action-primary underline"
                        >
                          PV lama
                        </button>
                      ) : (
                        <span className="font-sans text-[10.5px] text-text-muted">PV lama —</span>
                      )}
                      {ctx.transferInvoiceId ? (
                        <button onClick={() => viewBuktiTransfer(ctx.transferInvoiceId!)} className="font-sans text-[10.5px] font-semibold text-action-primary underline">
                          Transfer
                        </button>
                      ) : (
                        <span className="font-sans text-[10.5px] text-text-muted">Transfer —</span>
                      )}
                      {ctx.claimKey ? (
                        <button onClick={() => viewBuktiKlaim(ctx.claimKey!)} className="font-sans text-[10.5px] font-semibold text-action-primary underline">
                          Foto klaim
                        </button>
                      ) : (
                        <span className="font-sans text-[10.5px] text-text-muted">Foto klaim —</span>
                      )}
                    </span>
                    <span className="text-right">
                      <Button onClick={() => confirmDelete(e.id, `${label} — ${ctx.invoice?.id ?? e.id}`)} variant="danger" size="xs">
                        Hapus
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
    </AppShell>
  );
}
