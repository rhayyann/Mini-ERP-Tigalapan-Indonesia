import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { MrpProgressTable } from "@/components/dashboard/mrp-progress-table";

function VendorTimelineRow({ po, pct, color, textColor }: { po: string; pct: number; color: string; textColor: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-24 font-mono text-[11px] font-medium text-[#31414F]">{po}</span>
      <span className="relative h-4 flex-1 rounded-[3px] bg-surface-page">
        <span
          className="absolute top-0 bottom-0 flex items-center rounded-[3px] pl-2 font-mono text-[10px] font-semibold"
          style={{ left: "4%", width: `${pct}%`, background: color, color: textColor }}
        >
          {pct}%
        </span>
      </span>
    </div>
  );
}

export default function PpicDashboardPage() {
  return (
    <AppShell role="ppic" activeHref="/dashboard/ppic" breadcrumb={["Dashboard", "Overview"]} title="Overview produksi" subtitle="Minggu 34 · 24 Agu 2026">
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="PR Draft" value="5" sub="2 perlu disubmit hari ini" accent="blue" />
        <KpiCard label="PO Approved" value="12" sub="8.400 pcs terjadwal" accent="purple" />
        <KpiCard label="In Production" value="8" sub="di 4 vendor maklon" accent="orange" />
        <KpiCard
          label="Completion"
          accent="teal"
          value={
            <span className="flex items-baseline gap-1.5">
              <span className="text-success-fg">65%</span>
              <span className="font-mono text-[11px] font-medium text-success-fg">+4</span>
            </span>
          }
          sub={<span className="mt-1.5 block h-[5px] overflow-hidden rounded-[3px] bg-success-bg"><span className="block h-full w-[65%] rounded-[3px] bg-success" /></span>}
        />
      </div>

      <MrpProgressTable />

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 372px" }}>
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">Timeline produksi per vendor maklon</span>
            <span className="ml-auto flex gap-3 font-mono text-[10.5px] text-text-muted">
              <span>SEP W1</span>
              <span>W2</span>
              <span>W3</span>
              <span>W4</span>
            </span>
          </div>
          <div className="flex flex-col gap-3.5 px-4 py-3.5">
            <div>
              <div className="mb-1.5 font-sans text-xs font-semibold text-[#31414F]">
                PT Maklon ABC <span className="font-mono text-[11px] font-normal text-text-muted">· 3.500 / 5.000 pcs</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <VendorTimelineRow po="PO-MKL-001" pct={52} color="#2E6FA7" textColor="#fff" />
                <VendorTimelineRow po="PO-MKL-003" pct={34} color="#8FB4D4" textColor="#17384F" />
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-sans text-xs font-semibold text-[#31414F]">
                PT Maklon XYZ <span className="font-mono text-[11px] font-normal text-text-muted">· 2.100 / 3.000 pcs</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <VendorTimelineRow po="PO-MKL-002" pct={44} color="#1F8A55" textColor="#fff" />
                <VendorTimelineRow po="PO-MKL-004" pct={14} color="#C9791A" textColor="#fff" />
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-sans text-xs font-semibold text-[#31414F]">
                PT Maklon Sentosa <span className="font-mono text-[11px] font-normal text-text-muted">· 900 / 2.000 pcs</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <VendorTimelineRow po="PO-MKL-005" pct={26} color="#8FB4D4" textColor="#17384F" />
              </div>
            </div>
            <div className="flex gap-[18px] border-t border-[#EEF1F4] pt-3 font-sans text-[11px] text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-accent-blue" />
                Cutting
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-[#8FB4D4]" />
                Setup
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-success" />
                Selesai
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm bg-warning" />
                Menunggu bahan
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-[15px] py-3 font-sans text-[13px] font-semibold text-text-primary">Critical alerts</div>
            {[
              { title: "PO-001 · Maklon ABC", desc: "Material delayed 3 hari — 2 roll belum dikirim supplier XYZ", color: "#C0413A" },
              { title: "PO-005 · Maklon Sentosa", desc: "Cutting yield 94% — di bawah target 97%", color: "#C9791A" },
              { title: "PO-002 · Maklon XYZ", desc: "On track — FG complete, menunggu delivery", color: "#1F8A55" },
            ].map((a, i) => (
              <div key={i} className="border-b border-[#EEF1F4] px-[15px] py-[11px] last:border-b-0" style={{ borderLeft: `3px solid ${a.color}` }}>
                <div className="font-sans text-xs font-semibold text-text-primary">{a.title}</div>
                <div className="mt-0.5 font-sans text-[11.5px] leading-[1.45] text-text-muted">{a.desc}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-[15px] py-3 font-sans text-[13px] font-semibold text-text-primary">PR menunggu tindakan</div>
            {[
              { id: "PR-2026-084", desc: "3 roll · Pola A", tone: "neutral" as const, label: "DRAFT" },
              { id: "PR-2026-085", desc: "2 roll pengganti", tone: "warning" as const, label: "REPLACEMENT" },
              { id: "PR-2026-086", desc: "5 roll · Pola B, C", tone: "info" as const, label: "SUBMITTED" },
            ].map((pr) => (
              <div key={pr.id} className="flex items-center gap-2.5 border-b border-[#EEF1F4] px-[15px] py-2.5 last:border-b-0">
                <span className="font-mono text-[11.5px] font-medium text-[#31414F]">{pr.id}</span>
                <span className="font-sans text-[11.5px] text-text-muted">{pr.desc}</span>
                <StatusPill tone={pr.tone} className="ml-auto">
                  {pr.label}
                </StatusPill>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
