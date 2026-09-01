import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";

export default function VendorSupplierDashboardPage() {
  return (
    <AppShell
      role="vendorSupplier"
      activeHref="/dashboard/vendor-supplier"
      breadcrumb={["Dashboard", "Order Saya"]}
      title="Order & tagihan saya"
      subtitle="2 PO aktif · 14 roll dijadwalkan"
      actions={<button className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">Submit invoice</button>}
    >
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="PO aktif" value="2" valueClassName="text-2xl" className="px-[15px] py-[13px]" />
        <KpiCard label="Perlu dikirim" value="3 roll" valueClassName="text-2xl text-warning-fg" className="px-[15px] py-[13px]" />
        <KpiCard label="Belum dibayar" value="14,7 jt" valueClassName="text-2xl" className="px-[15px] py-[13px]" />
        <KpiCard label="Dibayar Agu" value="31,2 jt" valueClassName="text-2xl text-success-fg" className="px-[15px] py-[13px]" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">PO saya</div>
        <div
          className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: "130px 90px 1fr 130px 130px 110px" }}
        >
          <span>No. PO</span>
          <span>Roll</span>
          <span>Kirim ke</span>
          <span>Jadwal kirim</span>
          <span>Nilai</span>
          <span>Status</span>
        </div>
        {[
          { po: "PO-SUP-001", roll: 8, to: "Maklon ABC · Bandung", date: "02/09/2026", amount: "Rp 50.000.000", tone: "info" as const, label: "PARTIAL" },
          { po: "PO-SUP-004", roll: 6, to: "Maklon Sentosa · Solo", date: "08/09/2026", amount: "Rp 36.400.000", tone: "success" as const, label: "APPROVED" },
        ].map((r, i, arr) => (
          <div
            key={r.po}
            className={"grid items-center gap-x-2 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}
            style={{ gridTemplateColumns: "130px 90px 1fr 130px 130px 110px" }}
          >
            <span className="font-mono font-medium">{r.po}</span>
            <span className="font-mono">{r.roll}</span>
            <span>{r.to}</span>
            <span className="font-mono">{r.date}</span>
            <span className="font-mono font-medium">{r.amount}</span>
            <StatusPill tone={r.tone} className="justify-self-start">
              {r.label}
            </StatusPill>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Status pembayaran</div>
        {[
          { inv: "INV-234", desc: "Net 30 · jatuh tempo 30/09", amount: "Rp 14.775.000", tone: "warning" as const, label: "VERIFYING" },
          { inv: "INV-228", desc: "PV-091 · dibayar 18/08", amount: "Rp 31.200.000", tone: "success" as const, label: "PAID" },
        ].map((r, i, arr) => (
          <div key={r.inv} className={"flex items-center gap-3 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
            <span className="font-mono font-medium">{r.inv}</span>
            <span>{r.desc}</span>
            <span className="ml-auto font-mono font-medium">{r.amount}</span>
            <StatusPill tone={r.tone}>{r.label}</StatusPill>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
