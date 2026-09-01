import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";

export default function AdminDashboardPage() {
  return (
    <AppShell role="admin" activeHref="/dashboard/admin" breadcrumb={["Overview"]} title="Administrasi sistem">
      <div className="grid grid-cols-4 gap-3">
        <KpiCard label="Users aktif" value="42" valueClassName="text-2xl" sub="6 role" className="px-[15px] py-[13px]" />
        <KpiCard label="Entitas" value="17" valueClassName="text-2xl" sub="2 PT · 9 supplier · 6 maklon" className="px-[15px] py-[13px]" />
        <KpiCard label="SLA breach 30d" value="9" valueClassName="text-2xl text-danger-fg" sub="terbanyak: gate 5" className="px-[15px] py-[13px]" />
        <KpiCard label="Job queue" value="OK" valueClassName="text-2xl text-success-fg" sub="0 gagal · sync 2 mnt lalu" className="px-[15px] py-[13px]" />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">SLA config per gate</span>
            <span className="ml-auto font-sans text-[11.5px] font-medium text-accent-blue">Edit</span>
          </div>
          {[
            ["PPIC Input", "1 HD"],
            ["Vendor selection", "2 HD"],
            ["PO approval", "1 HD"],
            ["Cutting", "3 HD"],
            ["Invoice maklon", "5 HD"],
          ].map(([label, sla], i, arr) => (
            <div key={label} className={"flex px-4 py-2.5 font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
              <span>{label}</span>
              <span className="ml-auto font-mono">{sla}</span>
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Parameter sistem</div>
          {[
            { title: "Toleransi selisih berat", desc: "Default 7% · override per vendor (6 vendor)" },
            { title: "Retention maklon", desc: "10% · release 3 bulan setelah delivery" },
            { title: "Alert channel", desc: "In-app + email · WhatsApp (opsional)" },
          ].map((p, i, arr) => (
            <div key={p.title} className={"px-4 py-3" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
              <div className="font-sans text-xs font-semibold text-text-primary">{p.title}</div>
              <div className="mt-0.5 font-sans text-[11.5px] text-text-muted">{p.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
