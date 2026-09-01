import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";

function StatusBar({ ready, delivery, delayed }: { ready: number; delivery: number; delayed: number }) {
  return (
    <div className="mt-1.5 flex h-3.5 overflow-hidden rounded-[3px]">
      <span style={{ width: `${ready}%`, background: "#1F8A55" }} />
      {delivery > 0 && <span style={{ width: `${delivery}%`, background: "#8FB4D4" }} />}
      {delayed > 0 && <span style={{ width: `${delayed}%`, background: "#C0413A" }} />}
    </div>
  );
}

export default function ProcurementDashboardPage() {
  return (
    <AppShell role="procurement" activeHref="/dashboard/procurement" breadcrumb={["Dashboard", "Procurement"]} title="Perlu tindakan Anda" subtitle="13 item terbuka · 3 melewati SLA">
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="PO Pending" value="3" sub="1 lewat SLA 2 HD" subClassName="text-warning-fg" accent="orange" />
        <KpiCard label="Material Delayed" value="1" sub="Supplier XYZ · 2 roll" subClassName="text-danger-fg" accent="danger" />
        <KpiCard label="Invoice Pending" value="5" sub="Rp 62,4 jt" />
        <KpiCard label="Payment Pending" value="4" sub="Rp 48,1 jt" />
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Actions required</div>
          {[
            { title: "Close 2 roll PO-SUP-001", desc: "Supplier XYZ · shortage, reschedule bulan depan", color: "#C0413A", action: "Close PO", primary: true },
            { title: "Verifikasi invoice #INV-234", desc: "Selisih amount Rp 275.000 vs PO", color: "#C9791A", action: "Review", primary: false },
            { title: "Claim material Roll A-012", desc: "Maklon ABC · selisih berat 11,4% (std 8%)", color: "#C9791A", action: "Proses RMA", primary: false },
            { title: "Transfer roll A-012 → Maklon B", desc: "Belum cutting · aman dipindahkan", color: "#1F8A55", action: "Transfer", primary: false },
          ].map((item, i, arr) => (
            <div
              key={i}
              className={"flex items-center gap-3 px-4 py-3" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}
              style={{ borderLeft: `3px solid ${item.color}` }}
            >
              <div className="flex-1">
                <div className="font-sans text-[12.5px] font-semibold text-text-primary">{item.title}</div>
                <div className="font-sans text-[11.5px] text-text-muted">{item.desc}</div>
              </div>
              <span
                className={
                  item.primary
                    ? "rounded-md bg-action-primary px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-white"
                    : "rounded-md border border-[#CBD5DF] px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-action-primary"
                }
              >
                {item.action}
              </span>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Status material per vendor</div>
          <div className="flex flex-col gap-3.5 px-4 py-3.5">
            {[
              { name: "Supplier ABC", roll: 14, ready: 71, delivery: 22, delayed: 7, note: "Ready 10 · On delivery 3 · Delayed 1" },
              { name: "Supplier XYZ", roll: 10, ready: 80, delivery: 20, delayed: 0, note: "Ready 8 · On delivery 2" },
              { name: "Supplier Cemerlang", roll: 22, ready: 68, delivery: 23, delayed: 9, note: "Ready 15 · On delivery 5 · Delayed 2" },
            ].map((s) => (
              <div key={s.name}>
                <div className="flex font-sans text-xs font-semibold text-[#31414F]">
                  <span>{s.name}</span>
                  <span className="ml-auto font-mono text-[11px] font-normal text-text-muted">{s.roll} roll</span>
                </div>
                <StatusBar ready={s.ready} delivery={s.delivery} delayed={s.delayed} />
                <div className="mt-1 font-mono text-[11px] text-text-muted">{s.note}</div>
              </div>
            ))}
            <div className="flex gap-4 border-t border-[#EEF1F4] pt-3 font-sans text-[11px] text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-success" />
                Ready
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-[#8FB4D4]" />
                On delivery
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-danger" />
                Delayed
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center border-b border-border-subtle px-4 py-3">
          <span className="font-sans text-[13px] font-semibold text-text-primary">PR Inbox</span>
          <span className="ml-auto font-sans text-[11.5px] font-medium text-accent-blue">Lihat semua</span>
        </div>
        <div
          className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: "120px 1fr 120px 110px 110px 90px" }}
        >
          <span>No. PR</span>
          <span>Pola / roll</span>
          <span>Vendor maklon</span>
          <span>Target mulai</span>
          <span>SLA</span>
          <span>Status</span>
        </div>
        {[
          { id: "PR-2026-084", pola: "Pola A · 3 roll · 300 pcs", vendor: "Maklon ABC", target: "01/09", sla: "0.4 / 2 HD", slaColor: "#1F8A55", status: "NEW", bg: "#EEF4FA", fg: "#1F4E77" },
          { id: "PR-2026-083", pola: "Pola B · 2 roll · 160 pcs", vendor: "Maklon XYZ", target: "28/08", sla: "1.7 / 2 HD", slaColor: "#C9791A", status: "WIP", bg: "#FBF3E6", fg: "#8A5410" },
          { id: "PR-2026-081", pola: "Pola A, C · 5 roll · 520 pcs", vendor: "Maklon Sentosa", target: "26/08", sla: "3.2 / 2 HD", slaColor: "#C0413A", status: "OVERDUE", bg: "#FBEDEB", fg: "#96322C" },
        ].map((pr, i, arr) => (
          <div
            key={pr.id}
            className={"grid items-center gap-x-2 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}
            style={{ gridTemplateColumns: "120px 1fr 120px 110px 110px 90px" }}
          >
            <span className="font-mono font-medium">{pr.id}</span>
            <span>{pr.pola}</span>
            <span>{pr.vendor}</span>
            <span className="font-mono">{pr.target}</span>
            <span className="font-mono" style={{ color: pr.slaColor }}>
              {pr.sla}
            </span>
            <span className="justify-self-start rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ background: pr.bg, color: pr.fg }}>
              {pr.status}
            </span>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
