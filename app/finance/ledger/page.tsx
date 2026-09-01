import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";

const ROWS = [
  { inv: "INV-234", type: "SUPPLIER", vendor: "Supplier ABC", po: "PO-SUP-001", gross: "15.550.000", net: "14.775.000", agingPct: 100, agingColor: "#C0413A", agingLabel: "+4 hari", agingFg: "#96322C", pv: "—", tone: "danger" as const, status: "OVERDUE" },
  { inv: "MKL-001", type: "MAKLON", vendor: "Maklon ABC", po: "PO-MKL-001", gross: "8.450.000", net: "7.605.000", agingPct: 42, agingColor: "#C9791A", agingLabel: "12 / 30 hari", agingFg: "#8A5410", pv: "—", tone: "warning" as const, status: "APPROVAL", href: "/finance/invoice-maklon" },
  { inv: "INV-231", type: "SUPPLIER", vendor: "Supplier XYZ", po: "PO-SUP-002", gross: "9.600.000", net: "9.120.000", agingPct: 60, agingColor: "#2E6FA7", agingLabel: "18 / 30 hari", agingFg: "#1F4E77", pv: "PV-094", tone: "info" as const, status: "SUBMITTED" },
  { inv: "MKL-002", type: "MAKLON", vendor: "Maklon XYZ", po: "PO-MKL-002", gross: "21.400.000", net: "19.260.000", agingPct: 100, agingColor: "#1F8A55", agingLabel: "dibayar 18/08", agingFg: "#166844", pv: "PV-091", tone: "success" as const, status: "PAID" },
  { inv: "INV-228", type: "SUPPLIER", vendor: "Supplier ABC", po: "PO-SUP-000", gross: "32.800.000", net: "31.200.000", agingPct: 100, agingColor: "#1F8A55", agingLabel: "dibayar 18/08", agingFg: "#166844", pv: "PV-090", tone: "success" as const, status: "PAID" },
];

export default function LedgerPage() {
  return (
    <AppShell
      role="finance"
      activeHref="/finance/ledger"
      breadcrumb={["Dashboard", "Ledger"]}
      title="Invoice & payment ledger"
      subtitle="Agu 2026 · supplier & maklon · 2 entitas"
      actions={<button className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">Export</button>}
    >
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="grid grid-cols-5 gap-3 border-b border-border-subtle bg-[#FAFBFC] px-5 py-3.5">
          {[
            { label: "Total ditagih", value: "Rp 148,3 jt", color: "#1B2734" },
            { label: "Terverifikasi", value: "Rp 121,7 jt", color: "#1B2734" },
            { label: "Dibayar", value: "Rp 76,6 jt", color: "#166844" },
            { label: "Outstanding", value: "Rp 71,7 jt", color: "#8A5410" },
            { label: "Retention held", value: "Rp 18,6 jt", color: "#5B4380" },
          ].map((s) => (
            <div key={s.label}>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">{s.label}</div>
              <div className="mt-[3px] font-mono text-[19px] font-bold" style={{ color: s.color }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
        <div
          className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-5 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
          style={{ gridTemplateColumns: "104px 92px 1fr 116px 116px 108px 96px 104px" }}
        >
          <span>Invoice</span>
          <span>Tipe</span>
          <span>Vendor / PO</span>
          <span className="text-right">Bruto</span>
          <span className="text-right">Net</span>
          <span>Aging</span>
          <span>PV</span>
          <span>Status</span>
        </div>
        {ROWS.map((r, i, arr) => {
          const rowClass =
            "grid items-center gap-x-2 px-5 py-3 font-sans text-xs text-[#31414F]" +
            (i < arr.length - 1 ? " border-b border-[#EEF1F4]" : "") +
            (r.href ? " hover:bg-[#F7F9FB]" : "");
          const rowStyle = { gridTemplateColumns: "104px 92px 1fr 116px 116px 108px 96px 104px" };
          const content = (
            <>
              <span className="font-mono font-medium">{r.inv}</span>
              <span className={"justify-self-start rounded-full px-[7px] py-0.5 font-mono text-[9.5px] font-semibold " + (r.type === "MAKLON" ? "bg-rework-bg text-rework-fg" : "bg-[#EEF0F3] text-[#4B5B6B]")}>
                {r.type}
              </span>
              <span>
                {r.vendor} · <span className="font-mono text-text-muted">{r.po}</span>
              </span>
              <span className="text-right font-mono">{r.gross}</span>
              <span className="text-right font-mono font-medium">{r.net}</span>
              <span>
                <span className="block h-[5px] rounded-[3px] bg-[#EEF1F4]">
                  <span className="block h-full rounded-[3px]" style={{ width: `${r.agingPct}%`, background: r.agingColor }} />
                </span>
                <span className="font-mono text-[10px]" style={{ color: r.agingFg }}>
                  {r.agingLabel}
                </span>
              </span>
              <span className="font-mono text-[#31414F]">{r.pv === "—" ? <span className="text-[#94A3B0]">—</span> : r.pv}</span>
              <StatusPill tone={r.tone} className="justify-self-start">
                {r.status}
              </StatusPill>
            </>
          );
          return r.href ? (
            <Link key={r.inv} href={r.href} className={rowClass} style={rowStyle}>
              {content}
            </Link>
          ) : (
            <div key={r.inv} className={rowClass} style={rowStyle}>
              {content}
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-3.5 border-t border-border-subtle bg-[#FAFBFC] px-5 py-3.5">
          <div>
            <div className="font-sans text-xs font-semibold text-text-primary">Aging outstanding</div>
            <div className="mt-[9px] flex h-3 overflow-hidden rounded">
              <span className="bg-success" style={{ width: "38%" }} />
              <span className="bg-warning" style={{ width: "31%" }} />
              <span className="bg-danger" style={{ width: "31%" }} />
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] text-text-muted">0–15 hari 27,2 jt · 16–30 hari 22,3 jt · &gt;30 hari 22,2 jt</div>
          </div>
          <div>
            <div className="font-sans text-xs font-semibold text-text-primary">Retention schedule</div>
            <div className="mt-[9px] flex flex-col gap-[5px] font-sans text-[11.5px] text-text-muted">
              <span className="flex">
                Sep 2026 <span className="ml-auto font-mono text-[#31414F]">Rp 4,2 jt</span>
              </span>
              <span className="flex">
                Okt 2026 <span className="ml-auto font-mono text-[#31414F]">Rp 6,3 jt</span>
              </span>
              <span className="flex">
                Nov 2026 <span className="ml-auto font-mono text-[#31414F]">Rp 8,1 jt</span>
              </span>
            </div>
          </div>
          <div>
            <div className="font-sans text-xs font-semibold text-text-primary">Rekonsiliasi</div>
            <div className="mt-[9px] font-sans text-[11.5px] leading-[1.6] text-text-muted">
              1 invoice selisih nilai (INV-234, Rp 275.000)
              <br />0 PV tanpa invoice · 0 pembayaran ganda
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
