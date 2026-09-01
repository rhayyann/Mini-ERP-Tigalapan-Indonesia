"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { MrpWarnaBreakdownTable } from "@/components/mrp/mrp-warna-breakdown-table";
import { useMrpStore } from "@/lib/mrp/store";
import type { MrpDetail } from "@/lib/mrp/store";
import { effectiveMrpQty, formatDate, formatPcs, mrpWarnaBreakdown, ppicApprovalBadge, vendorsForMrp } from "@/lib/mrp/derive";

export default function ScmApprovalMrpPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const approvePpicMrp = useMrpStore((s) => s.approvePpicMrp);
  const rejectPpicMrp = useMrpStore((s) => s.rejectPpicMrp);

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  if (!mounted) return null;

  const pending = mrpDetails.filter((d) => d.ppicApproval === "WAITING_PPIC_APPROVAL");
  const history = mrpDetails.filter((d) => d.ppicApproval === "PPIC_APPROVED" || d.ppicApproval === "REJECTED");

  function reject(mrpId: string) {
    const note = (noteDraft[mrpId] ?? "").trim();
    if (!note) return;
    rejectPpicMrp(mrpId, note);
    setNoteDraft((prev) => ({ ...prev, [mrpId]: "" }));
  }

  // Kolom dibuat mirip tabel "Material Requirement Planning" di PPIC — supaya SCM bisa lihat
  // rincian per-warna (qty/roll/rib) dulu SEBELUM memutuskan, bukan cuma qty total, dengan cara
  // klik baris untuk expand (chevron di ujung kanan, lihat DataTable renderExpanded).
  const pendingColumns: ColumnDef<MrpDetail>[] = [
    { key: "kategori", label: "Kategori / Warna", default: true, render: (d) => `${d.mrp.kategori} · ${d.mrp.warna}` },
    { key: "qty", label: "Qty", default: true, align: "right", render: (d) => formatPcs(effectiveMrpQty(d.mrp.id, d.mrp.qty, maklonPOs)) + " pcs" },
    { key: "vendor", label: "Vendor", default: true, render: (d) => vendorsForMrp(d).join(", ") || "—" },
    { key: "tglSubmit", label: "Tanggal Diajukan", default: true, render: (d) => formatDate(d.dates.ppicSubmitted) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (d) => <StatusPill tone={ppicApprovalBadge(d.ppicApproval).tone}>{ppicApprovalBadge(d.ppicApproval).label}</StatusPill>,
    },
  ];

  const historyColumns: ColumnDef<MrpDetail>[] = [
    { key: "kategori", label: "Kategori / Warna", default: true, render: (d) => `${d.mrp.kategori} · ${d.mrp.warna}` },
    { key: "qty", label: "Qty", default: true, align: "right", render: (d) => formatPcs(effectiveMrpQty(d.mrp.id, d.mrp.qty, maklonPOs)) },
    { key: "vendor", label: "Vendor", default: true, render: (d) => vendorsForMrp(d).join(", ") || "—" },
    { key: "tglSubmit", label: "Tanggal Diajukan", default: true, render: (d) => formatDate(d.dates.ppicSubmitted) },
    { key: "tglKeputusan", label: "Tanggal Keputusan", default: true, render: (d) => formatDate(d.dates.ppicApproved) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (d) => <StatusPill tone={ppicApprovalBadge(d.ppicApproval).tone}>{ppicApprovalBadge(d.ppicApproval).label}</StatusPill>,
    },
    {
      key: "catatan",
      label: "Catatan",
      default: true,
      render: (d) => (d.ppicApproval === "REJECTED" ? d.ppicRejectionNote ?? "—" : "—"),
    },
  ];

  return (
    <AppShell
      role="scm"
      activeHref="/scm/approval-mrp"
      breadcrumb={["Dashboard", "Approval MRP"]}
      title="Approval MRP"
      subtitle={`${pending.length} MRP dari PPIC menunggu keputusan Anda`}
    >
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        MRP yang diimpor PPIC masuk ke sini dulu sebelum bisa diproses Procurement. Klik baris untuk lihat rincian per warna (qty/roll/rib) dulu, lalu{" "}
        <b>Setujui</b> untuk meneruskannya, atau <b>Tolak</b> (wajib isi alasan) supaya PPIC tahu perlu perbaikan apa sebelum impor ulang — tidak ada MRP
        yang tembus ke Procurement tanpa lewat sini.
      </div>

      <DataTable
        title="Menunggu approval"
        columns={pendingColumns}
        rows={pending}
        keyOf={(d) => d.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(d) => <span className="font-mono">{d.mrp.id}</span>}
        renderExpanded={(d) => (
          <div className="flex flex-col gap-3">
            <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(d)} />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={noteDraft[d.mrp.id] ?? ""}
                onChange={(e) => setNoteDraft((prev) => ({ ...prev, [d.mrp.id]: e.target.value }))}
                placeholder="Alasan (wajib diisi kalau mau Tolak, opsional kalau Setujui)…"
                className="input min-w-[280px] flex-1 text-[11.5px]"
              />
              <button
                onClick={() => approvePpicMrp(d.mrp.id)}
                className="rounded-md bg-success px-3.5 py-[7px] font-sans text-[11.5px] font-semibold text-white"
              >
                Setujui
              </button>
              <button
                onClick={() => reject(d.mrp.id)}
                disabled={!(noteDraft[d.mrp.id] ?? "").trim()}
                title={!(noteDraft[d.mrp.id] ?? "").trim() ? "Isi alasan penolakan dulu" : undefined}
                className="rounded-md border border-[#EFC9C4] bg-white px-3.5 py-[7px] font-sans text-[11.5px] font-semibold text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tolak
              </button>
            </div>
          </div>
        )}
        emptyText="Tidak ada MRP yang menunggu approval saat ini."
      />

      <DataTable
        title="Riwayat keputusan"
        columns={historyColumns}
        rows={history}
        keyOf={(d) => d.mrp.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(d) => <span className="font-mono">{d.mrp.id}</span>}
        renderExpanded={(d) => <MrpWarnaBreakdownTable breakdown={mrpWarnaBreakdown(d)} />}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(history.map((d) => d.mrp.id))), test: (d, v) => d.mrp.id === v },
          {
            label: "Status",
            options: Array.from(new Set(history.map((d) => ppicApprovalBadge(d.ppicApproval).label))),
            test: (d, v) => ppicApprovalBadge(d.ppicApproval).label === v,
          },
        ]}
        emptyText="Belum ada MRP yang diputuskan."
      />
    </AppShell>
  );
}
