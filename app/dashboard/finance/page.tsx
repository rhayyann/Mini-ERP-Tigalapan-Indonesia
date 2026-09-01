"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, localDateString, vendorInvoiceFinalAmount } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

function vendorName(id: string) {
  return VENDOR_PRODUKSI[id]?.name ?? id;
}

export default function FinanceDashboardPage() {
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);

  const stats = useMemo(() => {
    const today = localDateString(new Date());

    const materialAwaitingPayment = invoices.filter((i) => i.status === "INVOICED");
    const materialAwaitingAmount = materialAwaitingPayment.reduce((s, i) => s + i.totalBiaya, 0);

    const vendorAwaitingPayment = vendorInvoices.filter((i) => i.status === "APPROVED");
    const vendorAwaitingAmount = vendorAwaitingPayment.reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0);

    const materialPendingApproval = materialPOs.filter((p) => p.status !== "CANCELLED" && !p.approved);
    const maklonPendingApproval = maklonPOs.filter((p) => !p.approved);

    const totalPaid =
      invoices.filter((i) => i.status === "PAID" || i.status === "DELIVERY" || i.status === "RECEIVING" || i.status === "PRODUCTION_DONE" || i.status === "WAITING_PRODUCTION").reduce((s, i) => s + i.totalBiaya, 0) +
      vendorInvoices.filter((i) => i.status === "PAID").reduce((s, i) => s + vendorInvoiceFinalAmount(i), 0);

    let overdue = 0;
    let dueToday = 0;
    let dueSoon = 0;
    for (const inv of vendorAwaitingPayment) {
      if (!inv.dueDate) continue;
      const amount = vendorInvoiceFinalAmount(inv);
      if (inv.dueDate < today) overdue += amount;
      else if (inv.dueDate === today) dueToday += amount;
      else dueSoon += amount;
    }
    const overdueCount = vendorAwaitingPayment.filter((i) => i.dueDate && i.dueDate < today).length;

    const approvalRows = [
      ...materialPendingApproval.map((p) => ({ id: p.id, vendor: `${p.supplier} · ${p.rollCount} roll bahan`, entity: p.entity || "—", amount: p.amount })),
      ...maklonPendingApproval.map((p) => ({ id: p.id, vendor: `${vendorName(p.vendorProduksi)} · ${p.qty} pcs`, entity: p.entity || "—", amount: p.amount })),
    ].slice(0, 6);

    const verifyRows = [
      ...materialAwaitingPayment.map((i) => ({ id: i.id, vendor: i.supplier, amount: i.totalBiaya })),
      ...vendorAwaitingPayment.map((i) => ({ id: i.id, vendor: vendorName(i.vendorProduksi), amount: vendorInvoiceFinalAmount(i) })),
    ].slice(0, 6);

    return { materialAwaitingPayment, materialAwaitingAmount, vendorAwaitingPayment, vendorAwaitingAmount, materialPendingApproval, maklonPendingApproval, totalPaid, overdue, dueToday, dueSoon, overdueCount, approvalRows, verifyRows };
  }, [materialPOs, maklonPOs, invoices, vendorInvoices]);

  const totalApprovalPending = stats.materialPendingApproval.length + stats.maklonPendingApproval.length;

  return (
    <AppShell role="finance" activeHref="/dashboard/finance" breadcrumb={["Dashboard", "Finance"]} title="Posisi pembayaran" subtitle="Ringkasan seluruh entitas">
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="PO Menunggu Approval" value={String(totalApprovalPending)} sub={`${stats.materialPendingApproval.length} material · ${stats.maklonPendingApproval.length} maklon`} accent="orange" />
        <KpiCard label="Invoice Material Menunggu Bayar" value={String(stats.materialAwaitingPayment.length)} sub={formatRupiah(stats.materialAwaitingAmount)} />
        <KpiCard label="Invoice Vendor Menunggu Bayar" value={String(stats.vendorAwaitingPayment.length)} sub={formatRupiah(stats.vendorAwaitingAmount)} />
        <KpiCard label="Total Sudah Dibayar" value={formatRupiah(stats.totalPaid)} sub="material + vendor produksi" accent="teal" />
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Payment due (invoice vendor)</div>
          <div className="mt-2 flex flex-col gap-2">
            {[
              { label: "Overdue", value: stats.overdue, fg: "#96322C" },
              { label: "Due hari ini", value: stats.dueToday, fg: "#8A5410" },
              { label: "Due berikutnya", value: stats.dueSoon, fg: "#166844" },
            ].map((d) => (
              <div key={d.label} className="flex items-center gap-[9px]">
                <span className="h-[9px] w-[9px] rounded-sm" style={{ background: d.fg }} />
                <span className="font-sans text-xs font-medium text-[#31414F]">{d.label}</span>
                <span className="ml-auto font-mono text-[12.5px] font-semibold" style={{ color: d.fg }}>
                  {formatRupiah(d.value)}
                </span>
              </div>
            ))}
          </div>
          {stats.overdueCount > 0 && <div className="mt-[11px] border-t border-[#EEF1F4] pt-2.5 font-mono text-[11px] text-danger-fg">{stats.overdueCount} invoice vendor overdue</div>}
        </div>
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Invoice menunggu verifikasi</div>
          {stats.verifyRows.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada invoice menunggu.</div>}
          {stats.verifyRows.map((inv, i, arr) => (
            <div key={inv.id} className={"flex items-center gap-2.5 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
              <span className="font-mono font-medium">{inv.id}</span>
              <span>{inv.vendor}</span>
              <span className="ml-auto font-mono font-medium">{formatRupiah(inv.amount)}</span>
              <StatusPill tone="info">MENUNGGU</StatusPill>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center border-b border-border-subtle px-4 py-3">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Approval queue</span>
          <span className="ml-[9px] rounded-full bg-warning-bg px-2 py-0.5 font-mono text-[10px] font-semibold text-warning-fg">{totalApprovalPending} PENDING</span>
        </div>
        <div className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted" style={{ gridTemplateColumns: "130px 1fr 130px 130px" }}>
          <span>No. PO</span>
          <span>Vendor</span>
          <span>Entitas</span>
          <span>Nilai</span>
        </div>
        {stats.approvalRows.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada PO menunggu approval.</div>}
        {stats.approvalRows.map((r, i, arr) => (
          <div key={r.id} className={"grid items-center gap-x-2 px-4 py-3 font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")} style={{ gridTemplateColumns: "130px 1fr 130px 130px" }}>
            <span className="font-mono font-medium">{r.id}</span>
            <span>{r.vendor}</span>
            <span>{r.entity}</span>
            <span className="font-mono font-medium">{formatRupiah(r.amount)}</span>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
