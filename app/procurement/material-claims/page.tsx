"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatDecimal, materialClaimsList, type MaterialClaimRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

type ClaimStage = "BELUM" | "RETUR_DIMINTA" | "SELESAI";

function stageOf(key: string, resolutions: Record<string, unknown>, returRequests: Record<string, unknown>): ClaimStage {
  if (resolutions[key]) return "SELESAI";
  if (returRequests[key]) return "RETUR_DIMINTA";
  return "BELUM";
}

export default function MaterialClaimsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const resolveMaterialClaim = useMrpStore((s) => s.resolveMaterialClaim);
  const unresolveMaterialClaim = useMrpStore((s) => s.unresolveMaterialClaim);
  const requestMaterialClaimRetur = useMrpStore((s) => s.requestMaterialClaimRetur);
  const cancelMaterialClaimReturRequest = useMrpStore((s) => s.cancelMaterialClaimReturRequest);

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  if (!mounted) return null;

  const rows = materialClaimsList(invoices);
  const unresolvedCount = rows.filter((r) => stageOf(r.key, materialClaimResolutions, materialClaimReturRequests) !== "SELESAI").length;

  function submitResolve(key: string) {
    const note = (noteDraft[key] ?? "").trim();
    if (!note) return;
    resolveMaterialClaim(key, note);
    setNoteDraft((prev) => ({ ...prev, [key]: "" }));
  }

  function submitRetur(key: string) {
    const note = (noteDraft[key] ?? "").trim();
    if (!note) return;
    requestMaterialClaimRetur(key, note);
    setNoteDraft((prev) => ({ ...prev, [key]: "" }));
  }

  const stageLabel: Record<ClaimStage, { label: string; tone: "warning" | "info" | "success" }> = {
    BELUM: { label: "Belum ditindak", tone: "warning" },
    RETUR_DIMINTA: { label: "Retur diminta", tone: "info" },
    SELESAI: { label: "Sudah ditindak", tone: "success" },
  };

  const columns: ColumnDef<MaterialClaimRow>[] = [
    { key: "invoice", label: "No Invoice", default: true, render: (r) => <span className="font-mono font-medium">{r.invoiceId}</span> },
    { key: "supplierVendor", label: "Supplier → Vendor", default: true, render: (r) => `${r.supplier} → ${VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi}` },
    // default:false — warna/berat/tanggal dibatasi ke toggle "Kolom" supaya default tetap 7
    // kolom total; "Selisih" (alasan klaim ini ada) tetap prioritas dibanding rincian berat mentah.
    { key: "warna", label: "Warna / lengan", default: false, render: (r) => `${r.warna} · ${r.lengan}` },
    { key: "roll", label: "Roll", default: true, render: (r) => `#${r.rollIndex + 1}${r.codeRoll ? " · " + r.codeRoll : ""}` },
    {
      key: "berat",
      label: "Berat kotor → bersih",
      default: false,
      align: "right",
      render: (r) => (
        <span className="font-mono">
          {formatDecimal(r.grossKg)} → {formatDecimal(r.netKg)} kg
        </span>
      ),
    },
    {
      key: "selisih",
      label: "Selisih",
      default: true,
      align: "right",
      render: (r) => (
        <span className="font-mono font-semibold text-danger-fg">
          {r.diffKg >= 0 ? "+" : ""}
          {formatDecimal(r.diffKg)} kg ({r.pct.toFixed(1)}%)
        </span>
      ),
    },
    { key: "tanggal", label: "Tanggal terima", default: false, render: (r) => formatDate(r.receivedAt) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (r) => {
        const stage = stageOf(r.key, materialClaimResolutions, materialClaimReturRequests);
        return <StatusPill tone={stageLabel[stage].tone}>{stageLabel[stage].label}</StatusPill>;
      },
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => {
        const stage = stageOf(r.key, materialClaimResolutions, materialClaimReturRequests);
        if (stage === "SELESAI") {
          const resolution = materialClaimResolutions[r.key];
          return (
            <div className="flex min-w-[220px] items-start justify-between gap-2">
              <span className="font-sans text-[11.5px] text-text-muted">
                {resolution.note}
                <span className="block font-mono text-[10px]">{formatDate(resolution.resolvedAt)}</span>
              </span>
              <button onClick={() => unresolveMaterialClaim(r.key)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                Buka lagi
              </button>
            </div>
          );
        }
        if (stage === "RETUR_DIMINTA") {
          const req = materialClaimReturRequests[r.key];
          return (
            <div className="flex min-w-[240px] items-start justify-between gap-2">
              <span className="font-sans text-[11.5px] text-info-fg">
                Menunggu vendor timbang ulang roll pengganti.
                <span className="block text-text-muted">
                  {req.note} · <span className="font-mono text-[10px]">{formatDate(req.requestedAt)}</span>
                </span>
              </span>
              <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                Batalkan
              </button>
            </div>
          );
        }
        return (
          <div className="flex min-w-[260px] flex-col gap-1.5">
            <input
              value={noteDraft[r.key] ?? ""}
              onChange={(e) => setNoteDraft((prev) => ({ ...prev, [r.key]: e.target.value }))}
              placeholder="Catatan (mis. no. retur / estimasi ganti)…"
              className="input text-[11.5px]"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => submitRetur(r.key)}
                disabled={!(noteDraft[r.key] ?? "").trim()}
                title="Vendor akan diberi tahu untuk timbang ulang begitu roll pengganti sampai — klaim otomatis tertutup kalau hasil timbang ulang sudah sesuai toleransi."
                className="flex-none rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Minta Retur
              </button>
              <button
                onClick={() => submitResolve(r.key)}
                disabled={!(noteDraft[r.key] ?? "").trim()}
                title="Tandai selesai tanpa retur (mis. diterima apa adanya)"
                className="flex-none rounded-md border border-[#CBD5DF] px-2.5 py-[6px] font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Selesai
              </button>
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <AppShell
      role="procurement"
      activeHref="/procurement/material-claims"
      breadcrumb={["Dashboard", "Klaim Material"]}
      title="Klaim material"
      subtitle={`${rows.length} klaim selisih berat di luar toleransi (±2%) — ${unresolvedCount} belum selesai`}
    >
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
        Daftar ini otomatis berisi semua roll bahan yang diterima vendor produksi dengan selisih berat di luar toleransi (dikirim sebagai claim saat Good Receive). Sesuai proses
        yang berjalan: hubungi supplier untuk retur roll tsb, klik <b>Minta Retur</b> (vendor akan diberi tahu) — begitu roll pengganti sampai &amp; vendor timbang ulang dengan
        hasil sesuai toleransi, klaim ini <b>otomatis tertutup sendiri</b> (tidak perlu ditandai manual). Kalau ternyata tidak jadi retur (mis. diterima apa adanya), pakai{" "}
        <b>Selesai</b> langsung.
      </div>

      <DataTable
        title="Klaim selisih berat"
        columns={columns}
        rows={rows}
        keyOf={(r) => r.key}
        firstColumnLabel="No. MRP"
        firstColumnRender={(r) => <span className="font-mono">{r.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(rows.map((r) => r.mrpId))), test: (r, v) => r.mrpId === v },
          { label: "Vendor produksi", options: Array.from(new Set(rows.map((r) => r.vendorProduksi))), test: (r, v) => r.vendorProduksi === v },
          { label: "Supplier", options: Array.from(new Set(rows.map((r) => r.supplier))), test: (r, v) => r.supplier === v },
          {
            label: "Status",
            options: ["Belum ditindak", "Retur diminta", "Sudah ditindak"],
            test: (r, v) => {
              const stage = stageOf(r.key, materialClaimResolutions, materialClaimReturRequests);
              return stageLabel[stage].label === v;
            },
          },
        ]}
        emptyText="Belum ada klaim selisih berat di luar toleransi."
      />
    </AppShell>
  );
}
