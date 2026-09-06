"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatRupiah, vendorDepositBalance, vendorDepositEntriesFor, vendorDepositSuppliers } from "@/lib/mrp/derive";

type SupplierDepositRow = { supplier: string; balance: number; entryCount: number };

/** Revisi 2026-09-06: halaman baru "Saldo Deposit Vendor" -- murni transparansi (read-only), supaya
 *  saldo deposit hasil klaim yang diselesaikan lewat "retur + pesan ulang" (lihat
 *  material-claims/page.tsx & payment-panel.tsx) tidak pernah jadi angka blackbox meskipun tidak
 *  ada transaksi baru hari itu. 1 baris per supplier, expand untuk lihat seluruh ledger CREDIT/
 *  DEBIT-nya (dari klaim mana / dipakai bayar invoice apa, kapan, berapa). */
export default function VendorDepositPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const vendorDeposits = useMrpStore((s) => s.vendorDeposits);

  if (!mounted) return null;

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
          return (
            <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
              <div className="grid grid-cols-4 gap-x-2 bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                <span>Tanggal</span>
                <span>Jenis</span>
                <span>Sumber</span>
                <span className="text-right">Nilai</span>
              </div>
              {entries.map((e) => (
                <div key={e.id} className="grid grid-cols-4 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                  <span className="font-mono text-[10.5px]">{formatDate(e.createdAt)}</span>
                  <span>
                    <StatusPill tone={e.kind === "CREDIT" ? "success" : "warning"}>{e.kind === "CREDIT" ? "Kredit masuk" : "Dipakai bayar"}</StatusPill>
                  </span>
                  <span className="text-text-muted">
                    {e.kind === "CREDIT" ? (e.sourceClaimId ? `Klaim ${e.sourceClaimId}` : "—") : e.sourceInvoiceId ? `Invoice ${e.sourceInvoiceId}` : "—"}
                    {e.note ? ` — ${e.note}` : ""}
                  </span>
                  <span className={"text-right font-mono font-medium " + (e.kind === "CREDIT" ? "text-success-fg" : "text-danger-fg")}>
                    {e.kind === "CREDIT" ? "+" : "−"}
                    {formatRupiah(e.amount)}
                  </span>
                </div>
              ))}
            </div>
          );
        }}
      />
    </AppShell>
  );
}
