"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { ClaimReplacementModal } from "@/components/mrp/claim-replacement-modal";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatDecimal, materialClaimsList, materialClaimStage, type MaterialClaimRow, type MaterialClaimStage } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaterialClaimHistory } from "@/lib/mrp/types";
// Item 2.4: getMaterialClaimPhotoAction DIPANGGIL LANGSUNG dari halaman ini (bukan lewat store) --
// foto sengaja dikeluarkan dari snapshot (material_claim_photos, migration 0014), jadi tidak ada
// alur store/backgroundRefresh yang relevan di sini, cuma fetch on-demand saat user klik lihat.
import { getMaterialClaimPhotoAction } from "@/lib/mrp/actions";
// Revisi 2026-09-06: viewAndDownloadFile sekarang dipakai bareng di semua modul (Procurement/
// Finance/Vendor Produksi) untuk preview+download file -- fungsi ini sebelumnya dipakai jadi
// acuan pola-nya (lihat lib/mrp/clientFiles.ts), sekarang ditarik jadi satu fungsi bersama.
// Revisi 2026-09-08 (bug fix popup blocked): openPreviewWindow/fillPreviewWindow -- lihat
// catatan panjang di lib/mrp/clientFiles.ts.
import { openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";

async function viewClaimPhoto(claimKey: string) {
  const win = openPreviewWindow();
  try {
    const photo = await getMaterialClaimPhotoAction(claimKey);
    if (!photo) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, photo.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

function BuktiFotoCell({ claimKey, hasPhoto }: { claimKey: string; hasPhoto: boolean }) {
  if (!hasPhoto) return <span className="font-sans text-[11px] text-text-muted">—</span>;
  return (
    <button onClick={() => viewClaimPhoto(claimKey)} className="font-sans text-[11px] font-semibold text-action-primary underline">
      Lihat / Download
    </button>
  );
}

type ViewTab = "AKTIF" | "RIWAYAT";

export default function MaterialClaimsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const materialClaimResolutions = useMrpStore((s) => s.materialClaimResolutions);
  const materialClaimReturRequests = useMrpStore((s) => s.materialClaimReturRequests);
  const materialClaimReturDeliveries = useMrpStore((s) => s.materialClaimReturDeliveries);
  const materialClaimReturReceipts = useMrpStore((s) => s.materialClaimReturReceipts);
  // Flow bertahap 2026-09-11: dua dict baru untuk stage KLAIM_DITERIMA / PV_DIBUAT (lihat A2/D2).
  const materialClaimAcceptances = useMrpStore((s) => s.materialClaimAcceptances);
  const materialClaimReplacements = useMrpStore((s) => s.materialClaimReplacements);
  const materialClaimHistory = useMrpStore((s) => s.materialClaimHistory);
  const resolveMaterialClaim = useMrpStore((s) => s.resolveMaterialClaim);
  const unresolveMaterialClaim = useMrpStore((s) => s.unresolveMaterialClaim);
  const acceptMaterialClaim = useMrpStore((s) => s.acceptMaterialClaim);
  const markClaimReplacementShipped = useMrpStore((s) => s.markClaimReplacementShipped);
  const requestMaterialClaimRetur = useMrpStore((s) => s.requestMaterialClaimRetur);
  const cancelMaterialClaimReturRequest = useMrpStore((s) => s.cancelMaterialClaimReturRequest);
  const markMaterialClaimReturDelivered = useMrpStore((s) => s.markMaterialClaimReturDelivered);
  const createClaimReplacementInvoice = useMrpStore((s) => s.createClaimReplacementInvoice);
  const deleteMaterialClaimHistory = useMrpStore((s) => s.deleteMaterialClaimHistory);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);

  const [tab, setTab] = useState<ViewTab>("AKTIF");
  // Revisi 2026-09-06: key klaim yang sedang buka modal "Buat PV Pengganti" -- null = tidak ada.
  const [replacingKey, setReplacingKey] = useState<string | null>(null);

  if (!mounted) return null;

  // Item revisi 2026-09-07: material_claim_history (arsip di bawah) dulu tidak ikut cascade
  // terhapus waktu resetAllAction menghapus mrp (sama kasusnya dengan vendor_deposits, sudah
  // dibetulkan di actions.ts) -- baris LAMA yang sudah terlanjur "yatim" dari sebelum perbaikan
  // itu butuh cara dibersihkan manual, sama pola dengan "Hapus" di Saldo Deposit Vendor.
  function confirmDeleteHistory(id: string, label: string) {
    if (window.confirm(`Hapus permanen arsip klaim "${label}"? Tindakan ini tidak bisa dibatalkan.`)) {
      deleteMaterialClaimHistory(id);
    }
  }

  const archivedHistory = materialClaimHistory.filter((h) => h.resolvedAt);

  const rows = materialClaimsList(invoices);
  function stage(key: string): MaterialClaimStage {
    return materialClaimStage(
      key,
      materialClaimResolutions,
      materialClaimReturRequests,
      materialClaimReturDeliveries,
      materialClaimReturReceipts,
      materialClaimReplacements,
      materialClaimAcceptances
    );
  }
  const unresolvedCount = rows.filter((r) => stage(r.key) !== "SELESAI").length;

  const stageLabel: Record<MaterialClaimStage, { label: string; tone: "warning" | "info" | "success" }> = {
    BELUM: { label: "Belum ditindak", tone: "warning" },
    KLAIM_DITERIMA: { label: "Klaim diterima", tone: "info" },
    PV_DIBUAT: { label: "PV Dibuat", tone: "info" },
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
      // Item 13 (feedback batch 2026-09-10): kolom ini dulu SELALU angka selisih berat -- sekarang
      // bisa juga klaim FISIK (shading/kotor/dll, diajukan dari resting/cutting vendor produksi,
      // TIDAK ADA selisih berat sama sekali) -- tampilkan keterangan cacatnya sebagai ganti, plus
      // badge "Fisik" supaya beda jelas dari klaim berat.
      key: "selisih",
      label: "Selisih / Keterangan",
      default: true,
      align: "right",
      render: (r) =>
        r.reason === "FISIK" ? (
          <span className="flex items-center justify-end gap-1.5">
            <StatusPill tone="warning">Fisik</StatusPill>
            <span className="font-sans text-[11px] text-[#31414F]">{r.note || "—"}</span>
          </span>
        ) : (
          <span className="font-mono font-semibold text-danger-fg">
            {r.diffKg >= 0 ? "+" : ""}
            {formatDecimal(r.diffKg)} kg ({r.pct.toFixed(1)}%)
          </span>
        ),
    },
    // Item 2.5: bukti foto berat bersih yang diupload vendor saat mengajukan claim (item 3).
    { key: "buktiFoto", label: "Bukti foto", default: true, render: (r) => <BuktiFotoCell claimKey={r.key} hasPhoto={r.hasPhoto} /> },
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
            <div className="flex min-w-[200px] items-start justify-between gap-2">
              <span className="font-sans text-[11.5px] text-text-muted">{resolution?.note || "—"}</span>
              <button onClick={() => unresolveMaterialClaim(r.key)} className="flex-none font-sans text-[11px] font-semibold text-action-primary underline">
                Buka lagi
              </button>
            </div>
          );
        }
        // A8 (flow bertahap 2026-09-11): SATU tombol primer per tahap -- BELUM -> "Terima Klaim"
        // -> KLAIM_DITERIMA -> "Buat PV Pengganti" -> PV_DIBUAT -> "Tandai Sudah Dikirim" -> SELESAI.
        // Link "Minta Retur"/"Selesai" (manual close) DIHAPUS dari sini (D1 -- action-nya tetap
        // ada, cuma tidak lagi dipicu dari UI baru). Stage legacy (RETUR_*) pertahankan perilaku
        // lama apa adanya supaya klaim in-flight dari sebelum flow ini tetap bisa diselesaikan.
        if (s === "BELUM") {
          return (
            <button onClick={() => acceptMaterialClaim(r.key)} className="rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white">
              Terima Klaim
            </button>
          );
        }
        if (s === "KLAIM_DITERIMA") {
          return (
            <div className="flex flex-col items-start gap-1">
              <button onClick={() => setReplacingKey(r.key)} className="rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white">
                Buat PV Pengganti
              </button>
              <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="font-sans text-[10.5px] font-semibold text-action-primary underline">
                Batalkan
              </button>
            </div>
          );
        }
        if (s === "PV_DIBUAT") {
          const replacement = materialClaimReplacements[r.key];
          const replInvoice = replacement ? invoices.find((i) => i.id === replacement.invoiceId) : undefined;
          const waitingPayment = replInvoice?.status === "INVOICED";
          return (
            <div className="flex flex-col items-start gap-1">
              <button
                onClick={() => markClaimReplacementShipped(r.key)}
                disabled={waitingPayment}
                title={waitingPayment ? "Menunggu pembayaran Finance" : undefined}
                className="rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Tandai Sudah Dikirim
              </button>
              <span className="font-sans text-[10.5px] text-text-muted">
                PV pengganti {replacement?.invoiceId ?? "—"} — {replInvoice?.status ?? "—"}
                {waitingPayment && " (Menunggu pembayaran Finance)"}
              </span>
              <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="font-sans text-[10.5px] font-semibold text-action-primary underline">
                Batalkan
              </button>
            </div>
          );
        }
        // Jalur legacy (RETUR_DIMINTA / RETUR_DIKIRIM / RETUR_DITERIMA) -- perilaku dipertahankan
        // PERSIS seperti sebelumnya (D1), termasuk masih menampilkan "Buat PV Pengganti" karena
        // action itu sendiri tidak pernah mewajibkan retur fisik selesai dulu.
        return (
          <div className="flex flex-col items-start gap-1">
            <button onClick={() => setReplacingKey(r.key)} className="rounded-md bg-action-primary px-2.5 py-[6px] font-sans text-[11px] font-semibold text-white">
              Buat PV Pengganti
            </button>
            <div className="flex flex-wrap items-center gap-x-2 font-sans text-[10.5px] text-text-muted">
              {s === "RETUR_DIMINTA" && (
                <button onClick={() => markMaterialClaimReturDelivered(r.key)} className="font-semibold text-action-primary underline">
                  Tandai Sudah Dikirim
                </button>
              )}
              {s === "RETUR_DIKIRIM" && <span>Menunggu konfirmasi vendor</span>}
              {s === "RETUR_DITERIMA" && <span>Retur diterima vendor</span>}
              <button onClick={() => cancelMaterialClaimReturRequest(r.key)} className="font-semibold text-action-primary underline">
                Batalkan
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
      // BUG FIX (2026-09-10, migration 0025): kolom ini dulu SELALU angka selisih berat -- klaim
      // FISIK (reason "FISIK", tidak ada diffKg/pct sama sekali sejak migration 0025) akan
      // tampil "+0.00 kg (0.0%)" yang keliru/menyesatkan (seolah selisih beratnya memang 0).
      // Cabang sama persis pola kolom "Selisih / Keterangan" di tabel Klaim Aktif di atas.
      key: "selisihAwal",
      label: "Selisih (saat klaim)",
      default: true,
      align: "right",
      render: (h) =>
        h.reason === "FISIK" ? (
          <span className="flex items-center justify-end gap-1.5">
            <StatusPill tone="warning">Fisik</StatusPill>
            <span className="font-sans text-[11px] text-[#31414F]">{h.defectNote || "—"}</span>
          </span>
        ) : (
          <span className="font-mono">
            {(h.diffKg ?? 0) >= 0 ? "+" : ""}
            {formatDecimal(h.diffKg ?? 0)} kg ({(h.pct ?? 0).toFixed(1)}%)
          </span>
        ),
    },
    { key: "claimedAt", label: "Tanggal klaim", default: false, render: (h) => formatDate(h.claimedAt) },
    {
      key: "buktiFoto",
      label: "Bukti foto",
      default: true,
      render: (h) => <BuktiFotoCell claimKey={`${h.invoiceId}|${h.warna}|${h.lengan}|${h.rollIndex}`} hasPhoto={!!h.claimPhotoAt} />,
    },
    {
      key: "cara",
      label: "Cara selesai",
      default: true,
      render: (h) => (
        <StatusPill tone="success">
          {h.resolutionKind === "AUTO_REWEIGH" ? "Timbang ulang sesuai" : h.resolutionKind === "RETUR_REORDER" ? "Retur + pesan ulang" : "Ditutup manual"}
        </StatusPill>
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
          {h.resolutionKind === "RETUR_REORDER" && h.replacementInvoiceId && (
            <span>
              PV pengganti: <span className="font-mono font-medium text-text-primary">{h.replacementInvoiceId}</span> (lihat di Paying Voucher)
              {h.resolvedNote ? ` — ${h.resolvedNote}` : ""}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (h) => (
        <Button onClick={() => confirmDeleteHistory(h.id, `${h.invoiceId} · ${h.warna} · ${h.lengan} #${h.rollIndex + 1}`)} variant="danger" size="xs">
          Hapus
        </Button>
      ),
    },
  ];

  /** Rate (Rp/kg) yang berlaku di PV LAMA untuk klaim ini -- dicari dari colorEntries invoice
   *  asalnya, cuma dipakai untuk PREVIEW di modal (server menghitung ulang sendiri dari DB, lihat
   *  createClaimReplacementInvoiceAction). 0 kalau entah kenapa tidak ketemu (invoice hilang) --
   *  modal tetap bisa dipakai, preview kreditnya cuma jadi Rp 0. */
  function rateLamaFor(claim: MaterialClaimRow): number {
    const inv = invoices.find((i) => i.id === claim.invoiceId);
    const entry = inv?.colorEntries.find((c) => c.warna === claim.warna && c.lengan === claim.lengan);
    return entry?.hargaPerRoll ?? 0;
  }

  const replacingClaim = replacingKey ? rows.find((r) => r.key === replacingKey) ?? null : null;

  return (
    <AppShell
      role="procurement"
      activeHref="/procurement/material-claims"
      breadcrumb={["Dashboard", "Klaim Material"]}
      title="Klaim material"
      // Item 13: subtitle dulu berasumsi SEMUA klaim adalah selisih berat -- sekarang ada juga
      // klaim fisik (reason "FISIK"), jadi hitung terpisah supaya teksnya tetap akurat.
      subtitle={`${rows.length} klaim (${rows.filter((r) => r.reason === "BERAT").length} selisih berat KURANG dari toleransi −2%, ${rows.filter((r) => r.reason === "FISIK").length} fisik) — ${unresolvedCount} belum selesai`}
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
            Daftar ini otomatis berisi roll bahan yang diklaim vendor produksi — selisih berat KURANG dari toleransi (lebih ringan dari invoice), ATAU cacat
            FISIK (shading/kotor/dll, ditemukan vendor saat menghamparkan roll untuk resting/cutting — lihat badge &quot;Fisik&quot;). Prosesnya 3 langkah: (1){" "}
            <b>Terima Klaim</b> — tandai klaim ini sudah dilihat/ditindaklanjuti; (2) <b>Buat PV Pengganti</b> — pesan ulang bahan itu dengan rate & berat
            terkini (selisih dari nilai PV lama otomatis tercatat sebagai saldo deposit di supplier itu, lihat Payment di Finance); (3){" "}
            <b>Tandai Sudah Dikirim</b> — sekali klik setelah PV pengganti LUNAS, sekaligus mengirim PV pengganti itu ke Good Receive vendor (roll
            penggantinya baru bisa diisi code roll di sana) dan menutup klaim ini. Klaim lama yang masih berstatus retur (diminta/dikirim/diterima) tetap
            bisa diselesaikan lewat jalur lamanya.
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
                options: ["Belum ditindak", "Klaim diterima", "PV Dibuat", "Retur diminta", "Retur dikirim", "Retur diterima vendor", "Sudah ditindak"],
                test: (r, v) => stageLabel[stage(r.key)].label === v,
              },
              {
                label: "Bukti foto",
                options: ["Ada", "Tidak ada"],
                test: (r, v) => (v === "Ada" ? r.hasPhoto : !r.hasPhoto),
              },
            ]}
            emptyText="Belum ada klaim selisih berat KURANG dari toleransi."
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
                options: ["Timbang ulang sesuai", "Retur + pesan ulang", "Ditutup manual"],
                test: (h, v) =>
                  (h.resolutionKind === "AUTO_REWEIGH" ? "Timbang ulang sesuai" : h.resolutionKind === "RETUR_REORDER" ? "Retur + pesan ulang" : "Ditutup manual") === v,
              },
            ]}
            emptyText="Belum ada klaim yang selesai/diarsipkan."
          />
        </>
      )}

      {replacingClaim && (
        <ClaimReplacementModal
          claim={replacingClaim}
          rateLama={rateLamaFor(replacingClaim)}
          hargaKain={hargaKain}
          hargaKainPks={hargaKainPks}
          onCancel={() => setReplacingKey(null)}
          onSubmit={async (rateBaru, beratBaruKg, buktiInvoiceDataUrl, buktiInvoiceFileName) => {
            await createClaimReplacementInvoice(replacingClaim.key, rateBaru, beratBaruKg, buktiInvoiceDataUrl, buktiInvoiceFileName);
            setReplacingKey(null);
          }}
        />
      )}
    </AppShell>
  );
}
