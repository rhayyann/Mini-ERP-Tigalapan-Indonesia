import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { MiniBarChart } from "@/components/ui/mini-bar-chart";

function GateChevrons({ segments }: { segments: { label: string; bg: string; fg: string }[] }) {
  return (
    <div className="mt-[11px] flex items-center">
      {segments.map((s, i) => (
        <span
          key={i}
          className="font-mono text-[10px] font-semibold"
          style={{
            padding: i === 0 ? "5px 14px 5px 11px" : "5px 14px 5px 18px",
            marginLeft: i === 0 ? 0 : -8,
            background: s.bg,
            color: s.fg,
            clipPath:
              i === 0
                ? "polygon(0 0,calc(100% - 8px) 0,100% 50%,calc(100% - 8px) 100%,0 100%)"
                : i === segments.length - 1
                  ? "polygon(8px 0,100% 0,100% 100%,8px 100%,0 50%)"
                  : "polygon(8px 0,calc(100% - 8px) 0,100% 50%,calc(100% - 8px) 100%,8px 100%,0 50%)",
          }}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

const LOCKED = { bg: "#EEF1F4", fg: "#94A3B0" };

export default function VendorMaklonDashboardPage() {
  return (
    <AppShell role="vendorMaklon" activeHref="/dashboard/vendor-maklon" breadcrumb={["Dashboard", "Ringkasan"]} title="Order & kapasitas saya" subtitle="3 PO aktif · 1 claim terbuka">
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1fr" }}>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-[15px_17px]">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Kapasitas bulan ini</div>
          <div className="mt-[5px] flex items-baseline gap-[7px]">
            <span className="font-mono text-[26px] font-bold text-text-primary">3.500</span>
            <span className="font-mono text-xs text-text-muted">/ 5.000 pcs</span>
          </div>
          <div className="mt-2.5 flex h-5 overflow-hidden rounded">
            <span className="flex items-center bg-action-primary pl-2 font-mono text-[10px] font-semibold text-white" style={{ width: "70%" }}>
              70% ALLOCATED
            </span>
          </div>
          <div className="mt-2 font-mono text-[11px] text-success-fg">Available 1.500 pcs</div>
        </div>
        <KpiCard label="Cutting hari ini" value="640" sub="pcs · 3 line aktif" className="p-[15px_17px]" valueClassName="text-[26px]" />
        <KpiCard label="Yield rata-rata" value="98,4%" valueClassName="text-[26px] text-success-fg" sub="target ≥ 97%" className="p-[15px_17px]" />
        <KpiCard label="Tagihan outstanding" value="7,6 jt" valueClassName="text-[26px]" sub="1 invoice pending approval" subClassName="text-warning-fg" className="p-[15px_17px]" />
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 372px" }}>
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">PO approved — progress per gate</div>
          {[
            {
              po: "PO-MKL-001",
              qty: "1.800 pcs · Pola A, B",
              target: "20/09",
              est: "18/09",
              estColor: "#166844",
              segs: [
                { label: "MATERIAL ✓", ...{ bg: "#1F8A55", fg: "#fff" } },
                { label: "CUTTING 60%", bg: "#2E6FA7", fg: "#fff" },
                { label: "FG / QC", ...LOCKED },
                { label: "DELIVERY", ...LOCKED },
              ],
              action: "Input cutting",
              primary: true,
            },
            {
              po: "PO-MKL-002",
              qty: "1.200 pcs · Pola B",
              target: "25/09",
              est: "24/09",
              estColor: "#8A5410",
              segs: [
                { label: "ON DELIVERY 3D", bg: "#C9791A", fg: "#fff" },
                { label: "CUTTING", ...LOCKED },
                { label: "FG / QC", ...LOCKED },
                { label: "DELIVERY", ...LOCKED },
              ],
              action: "Lacak bahan",
              primary: false,
            },
            {
              po: "PO-MKL-003",
              qty: "500 pcs · Pola C",
              target: "15/09",
              est: "14/09",
              estColor: "#166844",
              segs: [
                { label: "MATERIAL ✓", bg: "#1F8A55", fg: "#fff" },
                { label: "CUTTING ✓", bg: "#1F8A55", fg: "#fff" },
                { label: "FG 80%", bg: "#2E6FA7", fg: "#fff" },
                { label: "DELIVERY", ...LOCKED },
              ],
              action: "Input FG",
              primary: true,
            },
          ].map((row, i, arr) => (
            <div key={row.po} className={"px-4 py-[15px]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")}>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[13px] font-semibold text-text-primary">{row.po}</span>
                <span className="font-sans text-xs text-text-muted">{row.qty}</span>
                <span className="ml-auto font-sans text-[11.5px] text-text-muted">
                  Target <span className="font-mono text-[#31414F]">{row.target}</span> · Est <span className="font-mono" style={{ color: row.estColor }}>{row.est}</span>
                </span>
              </div>
              <div className="flex items-center">
                <GateChevrons segments={row.segs} />
                <span
                  className={
                    "ml-auto rounded-md font-sans text-[11.5px] font-semibold " +
                    (row.primary ? "bg-action-primary px-[11px] py-[6px] text-white" : "border border-[#CBD5DF] px-[11px] py-[6px] text-action-primary")
                  }
                >
                  {row.action}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-[15px] py-3 font-sans text-[13px] font-semibold text-text-primary">Action items</div>
            {[
              { title: "Claim bahan Roll A-012", desc: "Selisih berat 11,4% · menunggu penggantian", color: "#C0413A" },
              { title: "Bahan PO-MKL-002", desc: "Menunggu 2 hari — line 2 idle", color: "#C9791A" },
              { title: "Invoice MKL-003", desc: "Pending approval procurement (1 HD)", color: "#1F8A55" },
            ].map((a, i, arr) => (
              <div key={i} className={"px-[15px] py-[11px]" + (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "")} style={{ borderLeft: `3px solid ${a.color}` }}>
                <div className="font-sans text-xs font-semibold text-text-primary">{a.title}</div>
                <div className="mt-0.5 font-sans text-[11.5px] leading-[1.45] text-text-muted">{a.desc}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-card p-[14px_15px]">
            <div className="font-sans text-[13px] font-semibold text-text-primary">Utilisasi line 7 hari</div>
            <div className="mt-3.5">
              <MiniBarChart
                height={88}
                data={[
                  { label: "S", pct: 72, color: "#22394F" },
                  { label: "S", pct: 84, color: "#22394F" },
                  { label: "R", pct: 60, color: "#8FB4D4" },
                  { label: "K", pct: 92, color: "#22394F" },
                  { label: "J", pct: 78, color: "#22394F" },
                  { label: "S", pct: 40, color: "#8FB4D4" },
                  { label: "M", pct: 12, color: "#E2E8EE" },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
