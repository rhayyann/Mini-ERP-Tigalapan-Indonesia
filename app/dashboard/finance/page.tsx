import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { MiniBarChart } from "@/components/ui/mini-bar-chart";

export default function FinanceDashboardPage() {
  return (
    <AppShell role="finance" activeHref="/dashboard/finance" breadcrumb={["Dashboard", "Finance"]} title="Posisi anggaran & pembayaran" subtitle="Periode Agu 2026 · 2 entitas">
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Budget bulan ini</div>
          <div className="mt-[5px] font-mono text-[26px] font-bold text-text-primary">Rp 500,0 jt</div>
          <div className="mt-3 flex h-[22px] overflow-hidden rounded">
            <span className="flex items-center bg-action-primary pl-[9px] font-mono text-[10.5px] font-semibold text-white" style={{ width: "70%" }}>
              COMMITTED 70%
            </span>
            <span className="bg-[#8FB4D4]" style={{ width: "20%" }} />
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2.5 font-sans text-[11.5px] text-text-muted">
            <div>
              <div className="font-mono text-[13px] font-semibold text-text-primary">350,0 jt</div>Committed
            </div>
            <div>
              <div className="font-mono text-[13px] font-semibold text-success-fg">150,0 jt</div>Available
            </div>
            <div>
              <div className="font-mono text-[13px] font-semibold text-warning-fg">450,0 jt</div>Forecast 90%
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Retention held</div>
          <div className="mt-[5px] font-mono text-[26px] font-bold text-text-primary">Rp 18,6 jt</div>
          <div className="mt-2 font-sans text-[11.5px] leading-[1.5] text-text-muted">7 invoice maklon · 2 jatuh release Sep 2026</div>
          <div className="mt-2.5 inline-block rounded-md border border-[#CBD5DF] px-[11px] py-[7px] font-sans text-[11.5px] font-semibold text-action-primary">Kelola release</div>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Payment due</div>
          <div className="mt-2 flex flex-col gap-2">
            {[
              { label: "Overdue", value: "Rp 45,0 jt", color: "#C0413A", fg: "#96322C" },
              { label: "Due hari ini", value: "Rp 30,0 jt", color: "#C9791A", fg: "#8A5410" },
              { label: "Due 3 hari", value: "Rp 60,0 jt", color: "#1F8A55", fg: "#166844" },
            ].map((d) => (
              <div key={d.label} className="flex items-center gap-[9px]">
                <span className="h-[9px] w-[9px] rounded-sm" style={{ background: d.color }} />
                <span className="font-sans text-xs font-medium text-[#31414F]">{d.label}</span>
                <span className="ml-auto font-mono text-[12.5px] font-semibold" style={{ color: d.fg }}>
                  {d.value}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-[11px] border-t border-[#EEF1F4] pt-2.5 font-mono text-[11px] text-text-muted">2 invoice overdue &gt; 5 hari</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="flex items-center border-b border-border-subtle px-4 py-3">
          <span className="font-sans text-[13px] font-semibold text-text-primary">Approval queue</span>
          <span className="ml-[9px] rounded-full bg-warning-bg px-2 py-0.5 font-mono text-[10px] font-semibold text-warning-fg">3 PENDING</span>
          <div className="ml-auto flex gap-2">
            <span className="rounded-md border border-[#CBD5DF] px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-action-primary">Reject terpilih</span>
            <span className="rounded-md bg-success px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-white">Approve terpilih</span>
          </div>
        </div>
        <div
          className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: "36px 130px 1fr 130px 130px 120px" }}
        >
          <span />
          <span>No. PO</span>
          <span>Vendor</span>
          <span>Entitas</span>
          <span>Nilai</span>
          <span>SLA</span>
        </div>
        {[
          { po: "PO-SUP-001", vendor: "Supplier ABC · 8 roll bahan katun", entity: "PT Garmen N.", amount: "Rp 50.000.000", sla: "0.3 / 1 HD", slaColor: "#1F8A55", checked: false },
          { po: "PO-MKL-002", vendor: "Maklon XYZ · 1.200 pcs, Pola B", entity: "PT Garmen N.", amount: "Rp 75.000.000", sla: "0.8 / 1 HD", slaColor: "#C9791A", checked: true },
          { po: "PO-SUP-003", vendor: "Supplier Cemerlang · 6 roll", entity: "PT Adikarya", amount: "Rp 40.000.000", sla: "1.4 / 1 HD", slaColor: "#C0413A", checked: false },
        ].map((r, i, arr) => (
          <div
            key={r.po}
            className={"grid items-center gap-x-2 px-4 py-3 font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}
            style={{ gridTemplateColumns: "36px 130px 1fr 130px 130px 120px" }}
          >
            <span className={"h-3.5 w-3.5 rounded-[3px] border" + (r.checked ? " border-accent-blue bg-accent-blue" : " border-[#B8C4D0]")} />
            <span className="font-mono font-medium">{r.po}</span>
            <span>{r.vendor}</span>
            <span>{r.entity}</span>
            <span className="font-mono font-medium">{r.amount}</span>
            <span className="font-mono" style={{ color: r.slaColor }}>
              {r.sla}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Invoice menunggu verifikasi</div>
          {[
            { id: "INV-234", vendor: "Supplier ABC", amount: "Rp 14.775.000", tone: "danger" as const, label: "MISMATCH" },
            { id: "MKL-001", vendor: "Maklon ABC", amount: "Rp 7.605.000", tone: "info" as const, label: "REVIEW" },
            { id: "INV-231", vendor: "Supplier XYZ", amount: "Rp 9.120.000", tone: "success" as const, label: "VERIFIED" },
          ].map((inv, i, arr) => (
            <div key={inv.id} className={"flex items-center gap-2.5 px-4 py-[11px] font-sans text-xs text-[#31414F]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
              <span className="font-mono font-medium">{inv.id}</span>
              <span>{inv.vendor}</span>
              <span className="ml-auto font-mono font-medium">{inv.amount}</span>
              <StatusPill tone={inv.tone}>{inv.label}</StatusPill>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
          <div className="font-sans text-[13px] font-semibold text-text-primary">Cash-out 8 minggu ke depan</div>
          <div className="mt-3">
            <MiniBarChart
              data={[
                { label: "W35", pct: 38, color: "#8FB4D4" },
                { label: "W36", pct: 66, color: "#22394F" },
                { label: "W37", pct: 52, color: "#8FB4D4" },
                { label: "W38", pct: 88, color: "#22394F" },
                { label: "W39", pct: 44, color: "#8FB4D4" },
                { label: "W40", pct: 30, color: "#8FB4D4" },
                { label: "W41", pct: 58, color: "#8FB4D4" },
                { label: "W42", pct: 22, color: "#8FB4D4" },
              ]}
            />
          </div>
          <div className="mt-2.5 border-t border-[#EEF1F4] pt-2.5 font-mono text-[11px] text-text-muted">Puncak W38: Rp 92,4 jt (5 PV jatuh tempo)</div>
        </div>
      </div>
    </AppShell>
  );
}
