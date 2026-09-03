"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatDecimal, materialClaimsList, materialClaimStage, type MaterialClaimRow, type MaterialClaimStage } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaterialClaimHistory } from "@/lib/mrp/types";

type ViewTab = "AKTIF" | "RIWAYAT";

export default function MaterialClaimsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  const resolveMaterialClaim = useMrpStore((s) => s.resolveMaterialClaim);
  const unresolveMaterialClaim = useMrpStore((s) => s.unresolveMaterialClaim);
  const requestMaterialClaimRetur = useMrpStore((s) => s.requestMaterialClaimRetur);
  const cancelMaterialClaimReturRequest = useMrpStore((s) => s.cancelMaterialClaimReturRequest);
  const markMaterialClaimReturDelivered = useMrpStore((s) => s.markMaterialClaimReturDelivered);

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<ViewTab>("AKTIF");

  if (!mounted) return null;

  const archivedHistory = materialClaimHistory.filter((h) => h.resolvedAt);

  const rows = materialClaimsList(invoices);
  function stage(key: string): MaterialClaimStage {
    return materialClaimStage(key, materialClaimResolutions, materialClaimReturRequests, materialClaimReturDeliveries, materialClaimReturReceipts);
  }
  const unresolvedCount = rows.filter((r) => stage(r.key) !== "SELESAI").length;

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

  function submitDelivered(key: string) {
    const note = (noteDraft[key] ?? "").trim();
    markMaterialClaimReturDelivered(key, note || undefined);
    setNoteDraft((prev) => ({ ...prev, [key]: "" }));
  }

  const stageLabel: Record<MaterialClaimStage, { label: string; tone: "warning" | "info" | "success" }> = {
    BELUM: { label: "Belum ditindak", tone: "warning" },
    RETUR_DIMINTA: { label: "Retur diminta", tone: "info" },
    RETUR_DIKIRIM: { label: "Retur dikirim", tone: "info" },
    RETUR_DITERIMA: { label: "Retur diterima vendor", tone: "info" },
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
        const s = stage(r.key);
        return <StatusPill tone={stageLabel[s].tone}>{stageLabel[s].label}</StatusPill>;
      },
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => {
        const s = stage(r.key);
        if (s === "SELESAI") {
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
        if (s === "RETUR_DITERIMA") {
          const receipt = materialClaimReturReceipts[r.key];
          return (
            <div className="flex min-w-[240px] items-start justify-between gap-2">
              <span className="font-sans text-[11.5px] text-info-fg">
                Vendor sudah terima roll pengganti — menunggu ditimbang ulang di Cutting.
                <span className="block font-mono text-[10px] text-text-muted">Diterima {formatDate(receipt.receivedAt)}</span>
              </span>
              <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                Batalkan
              </button>
            </div>
          );
        }
        if (s === "RETUR_DIKIRIM") {
          const delivery = materialClaimReturDeliveries[r.key];
          return (
            <div className="flex min-w-[240px] items-start justify-between gap-2">
              <span className="font-sans text-[11.5px] text-info-fg">
                Roll pengganti sudah dikirim — menunggu konfirmasi diterima dari vendor.
                <span className="block text-text-muted">
                  {delivery.note && <>{delivery.note} · </>}
                  <span className="font-mono text-[10px]">{formatDate(delivery.deliveredAt)}</span>
                </span>
              </span>
              <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                Batalkan
              </button>
            </div>
          );
        }
        if (s === "RETUR_DIMINTA") {
          const req = materialClaimReturRequests[r.key];
          return (
            <div className="flex min-w-[260px] flex-col gap-1.5">
              <span className="font-sans text-[11.5px] text-info-fg">
                Menunggu supplier kirim roll pengganti.
                <span className="block text-text-muted">
                  {req.note} · <span className="font-mono text-[10px]">{formatDate(req.requestedAt)}</span>
                </span>
              </span>
              <input
                value={noteDraft[r.key] ?? ""}
                onChange={(e) => setNoteDraft((prev) => ({ ...prev, [r.key]: e.target.value }))}
                placeholder="Catatan (opsional, mis. resi/estimasi tiba)…"
                className="input text-[11.5px]"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => submitDelivered(r.key)}
                  title="Tandai roll pengganti sudah dikirim ke vendor — vendor akan diberi tahu untuk konfirmasi setelah diterima."
                  className="flex-none rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white"
                >
                  Tandai Sudah Dikirim
                </button>
                <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                  Batalkan
                </button>
              </div>
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

  const historyColumns: ColumnDef<MaterialClaimHistory>[] = [
    { key: "invoice", label: "No Invoice", default: true, render: (h) => <span className="font-mono font-medium">{h.invoiceId}</span> },
    {
      key: "supplierVendor",
      label: "Supplier → Vendor",
      default: true,
      render: (h) => `${h.supplier ?? "—"} → ${VENDOR_PRODUKSI[h.vendorProduksi ?? ""]?.name ?? h.vendorProduksi ?? "—"}`,
    },
    { key: "warna", label: "Warna / lengan", default: false, render: (h) => `${h.warna} · ${h.lengan}` },
    { key: "roll", label: "Roll", default: true, render: (h) => `#${h.rollIndex + 1}${h.codeRoll ? " · " + h.codeRoll : ""}` },
    {
      key: "selisihAwal",
      label: "Selisih (saat klaim)",
      default: true,
      align: "right",
      render: (h) => (
        <span className="font-mono">
          {h.diffKg >= 0 ? "+" : ""}
          {formatDecimal(h.diffKg)} kg ({h.pct.toFixed(1)}%)
        </span>
      ),
    },
    { key: "claimedAt", label: "Tanggal klaim", default: false, render: (h) => formatDate(h.claimedAt) },
    {
      key: "cara",
      label: "Cara selesai",
      default: true,
      render: (h) => (
        <StatusPill tone="success">{h.resolutionKind === "AUTO_REWEIGH" ? "Timbang ulang sesuai" : "Ditutup manual"}</StatusPill>
      ),
    },
    { key: "resolvedAt", label: "Tanggal selesai", default: true, render: (h) => formatDate(h.resolvedAt) },
    {
      key: "detail",
      label: "Detail",
      default: true,
      render: (h) => (
        <div className="flex flex-col gap-0.5 font-sans text-[11px] text-text-muted">
          {h.returRequestedAt && <span>Retur diminta {formatDate(h.returRequestedAt)}{h.returNote ? ` — ${h.returNote}` : ""}</span>}
          {h.returDeliveredAt && <span>Dikirim {formatDate(h.returDeliveredAt)}{h.returDeliveredNote ? ` — ${h.returDeliveredNote}` : ""}</span>}
          {h.returReceivedAt && <span>Diterima vendor {formatDate(h.returReceivedAt)}</span>}
          {h.resolutionKind === "AUTO_REWEIGH" && h.resolvedNetKg !== undefined && (
            <span>
              Timbang ulang: {formatDecimal(h.resolvedNetKg)} kg{h.resolvedCodeRoll && h.resolvedCodeRoll !== h.codeRoll ? ` (code roll baru: ${h.resolvedCodeRoll})` : ""}
            </span>
          )}
          {h.resolutionKind === "MANUAL" && h.resolvedNote && <span>Catatan: {h.resolvedNote}</span>}
        </div>
      ),
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
      <div className="flex gap-2 rounded-lg border border-border-subtle bg-surface-card p-1.5">
        {(
          [
            { key: "AKTIF" as const, label: "Klaim Aktif", badge: unresolvedCount },
            { key: "RIWAYAT" as const, label: "Riwayat / Arsip", badge: 0 },
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "flex items-center gap-1.5 rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold " +
              (tab === t.key ? "bg-action-primary text-white" : "text-text-muted hover:bg-[#F7F9FB]")
            }
          >
            {t.label}
            {t.badge > 0 && <span className="flex-shrink-0 rounded-full bg-danger px-[5px] py-px font-mono text-[9px] font-semibold text-white">{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === "AKTIF" && (
        <>
          <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
            Daftar ini otomatis berisi semua roll bahan yang diterima vendor produksi dengan selisih berat di luar toleransi (dikirim sebagai claim saat Cutting
            menimbang). Alur: hubungi supplier untuk retur roll tsb → klik <b>Minta Retur</b> (vendor diberi tahu) → begitu supplier sudah kirim roll pengganti (mis.
            dikabari lewat WA), klik <b>Tandai Sudah Dikirim</b> → vendor konfirmasi terima di halaman Produksi (Cutting) → begitu vendor timbang ulang dengan hasil
            sesuai toleransi, klaim ini <b>otomatis tertutup sendiri</b> (tidak perlu ditandai manual, dan otomatis pindah ke tab Riwayat/Arsip). Kalau ternyata tidak
            jadi retur (mis. diterima apa adanya), pakai <b>Selesai</b> langsung — atau <b>Batalkan</b> dulu di tahap manapun untuk balik ke awal.
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
                options: ["Belum ditindak", "Retur diminta", "Retur dikirim", "Retur diterima vendor", "Sudah ditindak"],
                test: (r, v) => stageLabel[stage(r.key)].label === v,
              },
            ]}
            emptyText="Belum ada klaim selisih berat di luar toleransi."
          />
        </>
      )}

      {tab === "RIWAYAT" && (
        <>
          <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
            Arsip klaim selisih berat yang SUDAH SELESAI — baik lewat timbang ulang yang hasilnya sesuai toleransi, atau ditutup manual oleh Procurement. Murni
            pencatatan (read-only), tidak memengaruhi status produksi.
          </div>
          <DataTable
            title="Riwayat klaim selisih berat"
            columns={historyColumns}
            rows={archivedHistory}
            keyOf={(h) => h.id}
            firstColumnLabel="No. MRP"
            firstColumnRender={(h) => <span className="font-mono">{h.mrpId ?? "—"}</span>}
            filterDefs={[
              { label: "No MRP", options: Array.from(new Set(archivedHistory.map((h) => h.mrpId ?? "—"))), test: (h, v) => (h.mrpId ?? "—") === v },
              {
                label: "Vendor produksi",
                options: Array.from(new Set(archivedHistory.map((h) => h.vendorProduksi ?? "—"))),
                test: (h, v) => (h.vendorProduksi ?? "—") === v,
              },
              {
                label: "Cara selesai",
                options: ["Timbang ulang sesuai", "Ditutup manual"],
                test: (h, v) => (h.resolutionKind === "AUTO_REWEIGH" ? "Timbang ulang sesuai" : "Ditutup manual") === v,
              },
            ]}
            emptyText="Belum ada klaim yang selesai/diarsipkan."
          />
        </>
      )}
    </AppShell>
  );
}
