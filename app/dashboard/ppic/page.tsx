"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusPill } from "@/components/ui/status-pill";
import { MrpProgressTable } from "@/components/dashboard/mrp-progress-table";
import { useMrpStore } from "@/lib/mrp/store";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import { formatPcs } from "@/lib/mrp/derive";

function vendorName(id: string) {
  return VENDOR_PRODUKSI[id]?.name ?? id;
}

function VendorTimelineRow({ po, pct, color, textColor }: { po: string; pct: number; color: string; textColor: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-24 truncate font-mono text-[11px] font-medium text-[#31414F]">{po}</span>
      <span className="relative h-4 flex-1 rounded-[3px] bg-surface-page">
        <span
          className="absolute top-0 bottom-0 flex items-center rounded-[3px] pl-2 font-mono text-[10px] font-semibold"
          style={{ left: "4%", width: `${Math.min(100, pct)}%`, background: color, color: textColor }}
        >
          {pct}%
        </span>
      </span>
    </div>
  );
}

export default function PpicDashboardPage() {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const productionResults = useMrpStore((s) => s.productionResults);
  const notifications = useMrpStore((s) => s.notifications);

  const stats = useMemo(() => {
    const liveMrps = mrpDetails.filter((d) => d.mrp.live);
    const totalQty = liveMrps.reduce((s, d) => s + d.mrp.qty, 0);
    const waitingScm = mrpDetails.filter((d) => d.ppicApproval === "WAITING_PPIC_APPROVAL").length;
    const poSentCount = mrpDetails.filter((d) => d.poSent).length;

    // Total FG per (mrpId, vendorProduksi) -- dijumlah lintas warna/lengan (bukan per groupKey),
    // cukup akurat untuk ringkasan dashboard tanpa perlu import derive.cumulativeSizeQtyForGroup
    // per warna satu-satu.
    const fgByMrpVendor = new Map<string, number>();
    for (const r of productionResults) {
      if (r.kind !== "FG") continue;
      const key = `${r.mrpId}|${r.vendorProduksi}`;
      const qty = Object.values(r.sizeQty).reduce((a, b) => a + b, 0);
      fgByMrpVendor.set(key, (fgByMrpVendor.get(key) ?? 0) + qty);
    }

    const totalPlanned = maklonPOs.reduce((s, p) => s + p.qty, 0);
    const totalProduced = maklonPOs.reduce((s, p) => s + Math.max(0, fgByMrpVendor.get(`${p.mrpId}|${p.vendorProduksi}`) ?? 0), 0);
    const completion = totalPlanned > 0 ? Math.round((totalProduced / totalPlanned) * 100) : 0;

    const byVendor = new Map<string, { poId: string; mrpId: string; qty: number; fg: number }[]>();
    for (const p of maklonPOs) {
      const fg = Math.max(0, fgByMrpVendor.get(`${p.mrpId}|${p.vendorProduksi}`) ?? 0);
      const arr = byVendor.get(p.vendorProduksi) ?? [];
      arr.push({ poId: p.id, mrpId: p.mrpId, qty: p.qty, fg });
      byVendor.set(p.vendorProduksi, arr);
    }

    const rejectedMrps = mrpDetails.filter((d) => d.ppicApproval === "REJECTED" && d.ppicRejectionNote);
    const myNotifications = notifications.filter((n) => n.audience.includes("ppic")).slice(0, 5);

    return { totalQty, waitingScm, poSentCount, completion, byVendor, rejectedMrps, myNotifications };
  }, [mrpDetails, maklonPOs, productionResults, notifications]);

  const vendorEntries = Array.from(stats.byVendor.entries());
  const colors = ["#2E6FA7", "#1F8A55", "#8FB4D4", "#C9791A"];

  return (
    <AppShell role="ppic" activeHref="/dashboard/ppic" breadcrumb={["Dashboard", "Overview"]} title="Overview produksi" subtitle="Ringkasan seluruh MRP aktif">
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="MRP Aktif" value={String(mrpDetails.filter((d) => d.mrp.live).length)} sub={`${formatPcs(stats.totalQty)} pcs terjadwal`} accent="blue" />
        <KpiCard label="Menunggu Approval SCM" value={String(stats.waitingScm)} sub="perlu ditindaklanjuti PPIC" accent="purple" />
        <KpiCard label="PO Sudah Dikirim" value={String(stats.poSentCount)} sub={`dari ${mrpDetails.length} MRP`} accent="orange" />
        <KpiCard
          label="Completion"
          accent="teal"
          value={<span className="text-success-fg">{stats.completion}%</span>}
          sub={
            <span className="mt-1.5 block h-[5px] overflow-hidden rounded-[3px] bg-success-bg">
              <span className="block h-full rounded-[3px] bg-success" style={{ width: `${Math.min(100, stats.completion)}%` }} />
            </span>
          }
        />
      </div>

      <MrpProgressTable />

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 372px" }}>
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="flex items-center border-b border-border-subtle px-4 py-3">
            <span className="font-sans text-[13px] font-semibold text-text-primary">Progres produksi per vendor maklon</span>
          </div>
          <div className="flex flex-col gap-3.5 px-4 py-3.5">
            {vendorEntries.length === 0 && <div className="py-6 text-center font-sans text-xs text-text-muted">Belum ada PO produksi.</div>}
            {vendorEntries.map(([vendorId, pos], idx) => {
              const vendorQty = pos.reduce((s, p) => s + p.qty, 0);
              const vendorFg = pos.reduce((s, p) => s + p.fg, 0);
              return (
                <div key={vendorId}>
                  <div className="mb-1.5 font-sans text-xs font-semibold text-[#31414F]">
                    {vendorName(vendorId)} <span className="font-mono text-[11px] font-normal text-text-muted">· {formatPcs(vendorFg)} / {formatPcs(vendorQty)} pcs</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {pos.map((p) => (
                      <VendorTimelineRow
                        key={p.poId}
                        po={p.poId}
                        pct={p.qty > 0 ? Math.round((p.fg / p.qty) * 100) : 0}
                        color={colors[idx % colors.length]}
                        textColor="#fff"
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-[15px] py-3 font-sans text-[13px] font-semibold text-text-primary">MRP ditolak SCM</div>
            {stats.rejectedMrps.length === 0 && <div className="px-[15px] py-4 font-sans text-[11.5px] text-text-muted">Tidak ada MRP yang ditolak.</div>}
            {stats.rejectedMrps.map((d) => (
              <div key={d.mrp.id} className="border-b border-[#EEF1F4] px-[15px] py-[11px] last:border-b-0" style={{ borderLeft: "3px solid #C0413A" }}>
                <div className="font-sans text-xs font-semibold text-text-primary">{d.mrp.id}</div>
                <div className="mt-0.5 font-sans text-[11.5px] leading-[1.45] text-text-muted">{d.ppicRejectionNote}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-[15px] py-3 font-sans text-[13px] font-semibold text-text-primary">Notifikasi terbaru</div>
            {stats.myNotifications.length === 0 && <div className="px-[15px] py-4 font-sans text-[11.5px] text-text-muted">Belum ada notifikasi.</div>}
            {stats.myNotifications.map((n) => (
              <div key={n.id} className="flex items-start gap-2.5 border-b border-[#EEF1F4] px-[15px] py-2.5 last:border-b-0">
                <span className="mt-0.5 font-sans text-[11.5px] leading-[1.4] text-text-muted">{n.text}</span>
                {!n.read && (
                  <StatusPill tone="info" className="ml-auto shrink-0">
                    BARU
                  </StatusPill>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
