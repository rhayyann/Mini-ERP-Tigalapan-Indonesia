"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { VendorSwitchModal } from "@/components/mrp/vendor-switch-modal";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import {
  aduanRowsForVendor,
  formatDate,
  formatPcs,
  formatRupiah,
  maklonPoBadge,
  maklonPoDeliveryProgress,
  maklonPoDisplayStatus,
  maklonPoInvoiceLockedBy,
  maklonRateExplanation,
  materialGroupsByWarna,
  materialPoFullStatus,
  materialPoFullStatusBadge,
  materialRateExplanation,
  materialSupplierNamesForWarna,
  mrpDetailFor,
  summarizeRateSources,
  vendorProduksiRows,
} from "@/lib/mrp/derive";
import { exportMaklonPoPdf, exportMaterialPoPdf } from "@/lib/mrp/exportPoPdf";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaklonPO, MaterialPO } from "@/lib/mrp/types";

/** Badge kecil "Standar"/"PKS"/"Estimasi" di sebelah nilai Rupiah — hover untuk lihat rincian
 *  per lengan/warna (kenapa dapat harga itu, tonase/kapasitas berapa). Dipakai di 3 tempat:
 *  preview "Est. biaya" vendor produksi, kolom "Nilai" tabel PO Material, kolom "Nilai" tabel
 *  PO Vendor Produksi — semua bersumber dari fungsi yang sama di lib/mrp/derive.ts supaya label
 *  selalu konsisten dengan angka yang benar-benar dipakai. */
function RateBadge({ explanation }: { explanation: { sources: ("PKS" | "Standar" | "Estimasi")[]; lines: string[] } }) {
  if (explanation.lines.length === 0) return null;
  const summary = summarizeRateSources(explanation.sources);
  return (
    <span title={explanation.lines.join("\n")}>
      <StatusPill tone={summary.tone}>{summary.label}</StatusPill>
    </span>
  );
}

export default function PoApprovalPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);
  const switchAduanVendor = useMrpStore((s) => s.switchAduanVendor);
  const assignMaterialSupplier = useMrpStore((s) => s.assignMaterialSupplier);
  const sendPoToFinance = useMrpStore((s) => s.sendPoToFinance);
  const hargaKain = useMrpStore((s) => s.hargaKain);
  const hargaKainPks = useMrpStore((s) => s.hargaKainPks);
  const hargaMaklon = useMrpStore((s) => s.hargaMaklon);
  const supplierList = useMrpStore((s) => s.supplierList);

  const [selectedId, setSelectedId] = useState<string>("");
  const [drillVendor, setDrillVendor] = useState<string | null>(null);

  // MRP baru bisa dibuatkan PO setelah disetujui SCM (lihat approvePpicMrp di lib/mrp/store.ts) —
  // ini gerbang yang sengaja ditambahkan supaya PPIC tidak langsung "tembus" ke Procurement tanpa
  // direview atasan dulu.
  const selectable = mrpDetails.filter((d) => !d.poSent && d.ppicApproval === "PPIC_APPROVED");
  const awaitingScm = mrpDetails.filter((d) => !d.poSent && d.ppicApproval === "WAITING_PPIC_APPROVAL").length;

  useEffect(() => {
    if (!selectedId && selectable.length > 0) setSelectedId(selectable[0].mrp.id);
  }, [selectable, selectedId]);

  if (!mounted) return null;

  const detail = mrpDetails.find((d) => d.mrp.id === selectedId && !d.poSent);
  const vendorRows = detail ? vendorProduksiRows(detail, hargaMaklon) : [];
  const allMaterialAssigned = detail ? detail.materialRows.every((m) => m.supplier) : false;

  const materialColumns: ColumnDef<MaterialPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendorSupplier", label: "Supplier → Vendor", default: true, render: (p) => `${p.supplier} → ${VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi}` },
    { key: "roll", label: "Roll", default: true, align: "right", render: (p) => p.rollCount + " roll" },
    {
      key: "nilai",
      label: "Nilai",
      default: true,
      align: "right",
      render: (p) => (
        <span className="flex items-center justify-end gap-1.5">
          {formatRupiah(p.amount)}
          <RateBadge explanation={materialRateExplanation(hargaKain, hargaKainPks, p.supplier, p.colorBreakdown)} />
        </span>
      ),
    },
    { key: "tglMrp", label: "Tanggal MRP", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.created) },
    { key: "tglPO", label: "Tanggal PO", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.poSent) },
    { key: "tglApproved", label: "Tanggal Disetujui", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.poApproved) },
    { key: "tglPayment", label: "Tanggal Payment", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.firstPayment) },
    {
      key: "entitas",
      label: "Entitas",
      // default:false — bukan cuma karena belum final sebelum approved (lihat catatan render di
      // bawah), tapi juga bagian dari pembatasan default tabel ke 7 kolom (lihat catatan di
      // materialColumns/maklonColumns): entitas gampang dicek lewat toggle "Kolom" kalau perlu.
      default: false,
      // Entitas final ditentukan Finance saat PO Approval (lihat setMaterialPoEntity/
      // splitMaterialPoByEntitas) — sebelum itu p.entity cuma DEFAULT (entitas pertama di Master
      // Data), belum keputusan final. Disembunyikan dulu di sini supaya Procurement tidak
      // mengira ini sudah ditetapkan.
      render: (p) => (p.approved ? p.entity : <span className="text-text-muted" title="Menunggu input dari Finance">-</span>),
    },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const s = materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices);
        return <StatusPill tone={materialPoFullStatusBadge(s).tone}>{materialPoFullStatusBadge(s).label}</StatusPill>;
      },
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => (
        <Button
          onClick={() => exportMaterialPoPdf(p, mrpDetails, hargaKain, hargaKainPks)}
          disabled={!p.supplier}
          title={!p.supplier ? "Tetapkan vendor material dulu" : undefined}
          variant="ghost"
          size="xs"
        >
          Download PO
        </Button>
      ),
    },
  ];

  function mrpSubtitle(rows: { mrpId: string }[]): string | undefined {
    const ids = Array.from(new Set(rows.map((r) => r.mrpId)));
    if (ids.length === 0) return undefined;
    return ids.length <= 4 ? `No. MRP: ${ids.join(", ")}` : `${ids.length} MRP`;
  }

  // Dulu cuma menampilkan status WAITING_APPROVAL — begitu Finance approve, row (dan tombol
  // Download PO-nya) hilang dari tabel, padahal Procurement justru BUTUH download PDF-nya
  // SETELAH disetujui (untuk dikirim ke pihak luar/vendor via WA, dsb). Sekarang tampilkan
  // semua PO material (kecuali yang dibatalkan), konsisten dengan tabel PO Vendor Produksi di
  // bawah yang memang sudah begini dari awal — filter Status tersedia kalau cuma mau lihat
  // yang masih pending.
  const allMaterialPOs = materialPOs.filter((p) => p.status !== "CANCELLED");

  const maklonColumns: ColumnDef<MaklonPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Vendor", default: true, render: (p) => VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi },
    { key: "qty", label: "Qty", default: true, align: "right", render: (p) => formatPcs(p.qty) + " pcs" },
    {
      key: "nilai",
      label: "Nilai",
      default: true,
      align: "right",
      render: (p) => {
        // Rincian dihitung ulang dari aduanRows saat ini (via mrpDetails) — akurat untuk PO yang
        // belum pernah disesuaikan (kasus paling umum). Kalau PO ini sempat kena
        // closePoWithReason/transferMaterial, angka p.amount sendiri sudah benar (pola "rate
        // efektif dipertahankan", lihat lib/mrp/store.ts) tapi rincian di sini bisa sedikit
        // meleset dari histori aslinya — tetap berguna sebagai gambaran umum.
        const aduanRows = mrpDetailFor(p.mrpId, mrpDetails)?.aduanRows.filter((a) => a.vendor === p.vendorProduksi) ?? [];
        return (
          <span className="flex items-center justify-end gap-1.5">
            {formatRupiah(p.amount)}
            <RateBadge explanation={maklonRateExplanation(hargaMaklon, p.vendorProduksi, aduanRows)} />
          </span>
        );
      },
    },
    { key: "tglMrp", label: "Tanggal MRP", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.created) },
    { key: "tglPO", label: "Tanggal PO", default: false, render: (p) => formatDate(mrpDetailFor(p.mrpId, mrpDetails)?.dates.poSent) },
    {
      // default:false — sudah terwakili "Status" (begitu status maju dari FULL_WAITING_MATERIAL
      // dst, PO itu pasti approved), jadi kolom ini murni berguna SEBELUM approve saja.
      key: "approved",
      label: "Approved",
      default: false,
      render: (p) => <StatusPill tone={p.approved ? "success" : "warning"}>{p.approved ? "Ya" : "Menunggu"}</StatusPill>,
    },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) });
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
    {
      key: "progress",
      label: "Progress kirim/tagih",
      // default:false — visual 2-bar ini bagus untuk deep-dive tapi berat (multi-baris per
      // sel), jadi dijadikan opsional lewat toggle "Kolom" supaya tabel tetap ringkas &
      // presisi sebagai default (lihat pembatasan 7 kolom total termasuk kolom identitas).
      default: false,
      render: (p) => {
        // Kalau PO ini terlanjur ditagih lewat jalur Invoice Maklon lama (lump sum), progress
        // qty-per-pcs di bawah tidak relevan — invoicedQty akan selalu 0 walau sudah lunas,
        // jadi tampilkan label lain daripada menyesatkan (lihat catatan di maklonPoDeliveryProgress).
        const lockedBy = maklonPoInvoiceLockedBy(p.mrpId, p.vendorProduksi, maklonInvoices, vendorInvoices);
        if (lockedBy === "maklon") {
          return <span className="font-sans text-[11px] font-medium text-text-muted">Ditagih via Invoice Maklon (lump sum)</span>;
        }
        const prog = maklonPoDeliveryProgress(p, deliveryKolis, vendorInvoices);
        return (
          <div className="flex flex-col gap-1.5 min-w-[150px]">
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Kirim</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.deliveredQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-success" style={{ width: `${prog.deliveredPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.deliveredPct}%</span>
            </div>
            <div className="flex items-baseline gap-1 font-mono text-[11px]">
              <span className="text-text-muted">Tagih</span>
              <span className="font-semibold text-[#31414F]">{formatPcs(prog.invoicedQty)}</span>
              <span className="text-text-muted">/ {formatPcs(prog.targetQty)} pcs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-full max-w-[110px] flex-1 overflow-hidden rounded-full bg-[#EEF0F3]">
                <span className="block h-full rounded-full bg-accent-blue" style={{ width: `${prog.invoicedPct}%` }} />
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">{prog.invoicedPct}%</span>
            </div>
          </div>
        );
      },
    },
    {
      // default:false — hampir selalu "—" (cuma terisi kalau ada line yang dibatalkan), jadi
      // dijadikan opsional lewat toggle "Kolom" biar tidak jadi kolom dash kosong terus-menerus.
      key: "cancelLines",
      label: "Cancel line",
      default: false,
      render: (p) =>
        p.cancelledLines.length
          ? p.cancelledLines.map((c, i) => (
              <div key={i} className="text-danger-fg">
                {c.warna ? `${c.warna} · ${c.lengan} — ` : ""}
                {c.rolls} roll{c.pcs ? ` (${c.pcs} pcs)` : ""}: {c.note}
              </div>
            ))
          : "—",
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (p) => (
        <Button onClick={() => exportMaklonPoPdf(p, mrpDetails, hargaMaklon)} variant="ghost" size="xs">
          Download PO
        </Button>
      ),
    },
  ];

  return (
    <AppShell role="procurement" activeHref="/procurement/po-approval" breadcrumb={["Dashboard", "Purchase Order"]} title="Purchase Order">
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">MRP tanpa PO</div>
            {selectable.length > 0 && (
              <StatusPill tone="warning">{selectable.length} MRP belum dibuatkan PO</StatusPill>
            )}
            {awaitingScm > 0 && (
              <span title="MRP dari PPIC yang belum disetujui SCM — belum bisa diproses di sini">
                <StatusPill tone="neutral">{awaitingScm} MRP menunggu approval SCM</StatusPill>
              </span>
            )}
          </div>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setDrillVendor(null);
            }}
            className="mt-1 rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            <option value="">— pilih MRP —</option>
            {selectable.map((d) => (
              <option key={d.mrp.id} value={d.mrp.id}>
                {d.mrp.id} · {formatPcs(d.mrp.qty)} pcs
              </option>
            ))}
          </select>
        </div>
        {detail && (
          <button
            onClick={() => allMaterialAssigned && sendPoToFinance(detail.mrp.id)}
            disabled={!allMaterialAssigned}
            title={!allMaterialAssigned ? "Tetapkan vendor material untuk semua baris dulu" : undefined}
            className="ml-auto rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Kirim PO ke Finance
          </button>
        )}
      </div>

      {!detail && selectable.length === 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-8 text-center font-sans text-xs text-text-muted">
          {awaitingScm > 0 ? (
            <>
              {awaitingScm} MRP dari PPIC sedang menunggu approval SCM — belum bisa dibuatkan PO sampai disetujui.
            </>
          ) : (
            <>
              Belum ada MRP yang perlu dibuatkan PO.{" "}
              <Link href="/mrp/ppic" className="font-semibold text-action-primary">
                Import MRP baru dari halaman MRP Saya.
              </Link>
            </>
          )}
        </div>
      )}

      {!detail && selectable.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-8 text-center font-sans text-xs text-text-muted">
          Pilih salah satu MRP di atas untuk mulai membuat PO.
        </div>
      )}

      {detail && (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "1.3fr 1fr" }}>
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Vendor produksi</div>
            <div
              className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "1fr 80px 80px 55px 130px" }}
            >
              <span>Nama vendor</span>
              <span className="text-right">Qty plan</span>
              <span className="text-right">Kapasitas</span>
              <span className="text-right">%</span>
              <span className="text-right">Est. biaya</span>
            </div>
            {vendorRows.map((v) => {
              const aduanRows = detail?.aduanRows.filter((a) => a.vendor === v.vendor) ?? [];
              return (
                <button
                  key={v.vendor}
                  onClick={() => setDrillVendor(v.vendor)}
                  className="grid w-full items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] text-left font-sans text-xs text-[#31414F] last:border-b-0 hover:bg-[#F7F9FB]"
                  style={{ gridTemplateColumns: "1fr 80px 80px 55px 130px" }}
                >
                  <span className="font-medium">{v.name}</span>
                  <span className="text-right font-mono">{formatPcs(v.qty)}</span>
                  <span className="text-right font-mono">{formatPcs(VENDOR_PRODUKSI[v.vendor]?.baseCapacity ?? 0)}</span>
                  <span className="text-right font-mono">{v.capacityPct}%</span>
                  <span className="flex flex-col items-end gap-0.5 font-mono">
                    <span>{formatRupiah(v.fee)}</span>
                    <RateBadge explanation={maklonRateExplanation(hargaMaklon, v.vendor, aduanRows)} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Material</div>
            <div
              className="grid gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "1fr 50px 60px 1fr" }}
            >
              <span>Warna</span>
              <span className="text-right">Roll</span>
              <span className="text-right">Rib kg</span>
              <span>Vendor material</span>
            </div>
            {materialGroupsByWarna(detail.materialRows).map((g) => {
              // Dipersempit ke supplier yang benar-benar punya harga untuk warna ini di Harga
              // Kain (+ daftar manual tab Supplier) — supaya tidak bisa pilih kombinasi
              // supplier+warna yang harganya tidak ada sama sekali (yang berujung PO jatuh ke
              // fallback "Estimasi" pakai angka flat jauh di bawah harga pasar).
              const optionsForWarna = materialSupplierNamesForWarna(hargaKain, supplierList, g.warna);
              return (
                <div key={g.warna} className="grid gap-x-3 items-center border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0" style={{ gridTemplateColumns: "1fr 50px 60px 1fr" }}>
                  <span>{g.warna}</span>
                  <span className="text-right font-mono">{g.totalRoll}</span>
                  <span className="text-right font-mono">{g.totalRibKg.toLocaleString("id-ID", { maximumFractionDigits: 2 })}</span>
                  <select
                    value={g.supplier ?? ""}
                    onChange={(e) => {
                      // Satu pilihan supplier berlaku untuk SEMUA lengan warna ini (pendek +
                      // panjang digabung jadi satu keputusan bahan) — bukan per lengan lagi.
                      const supplier = e.target.value;
                      g.rowIds.forEach((rowId) => assignMaterialSupplier(detail.mrp.id, rowId, supplier));
                    }}
                    className="rounded-md border border-[#DDE4EB] px-2 py-[5px] font-sans text-[11.5px] font-medium text-text-primary"
                  >
                    <option value="">— pilih vendor —</option>
                    {optionsForWarna.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {optionsForWarna.length === 0 && (
                    <div className="col-span-4 -mt-1.5 pb-0.5 font-sans text-[10.5px] font-medium text-warning-fg">
                      ⚠ Belum ada supplier dengan harga untuk warna {g.warna} di Master Data Harga Kain.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <DataTable
        title="PO Material — semua PO yang sudah dibuatkan"
        subtitle={mrpSubtitle(allMaterialPOs)}
        columns={materialColumns}
        rows={allMaterialPOs}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(allMaterialPOs.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          { label: "No PO", options: Array.from(new Set(allMaterialPOs.map((p) => p.id))), test: (p, v) => p.id === v },
          { label: "Vendor produksi", options: Array.from(new Set(allMaterialPOs.map((p) => p.vendorProduksi))), test: (p, v) => p.vendorProduksi === v },
          { label: "Entitas", options: Array.from(new Set(allMaterialPOs.map((p) => p.entity))), test: (p, v) => p.entity === v },
          {
            label: "Status",
            options: Array.from(new Set(allMaterialPOs.map((p) => materialPoFullStatusBadge(materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices)).label))),
            test: (p, v) => materialPoFullStatusBadge(materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices)).label === v,
          },
        ]}
        emptyText="Belum ada PO material yang dibuat."
      />

      <DataTable
        title="PO Vendor Produksi — semua MRP yang sudah dibuatkan PO"
        subtitle={mrpSubtitle(maklonPOs)}
        columns={maklonColumns}
        rows={maklonPOs}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(maklonPOs.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          { label: "No PO", options: Array.from(new Set(maklonPOs.map((p) => p.id))), test: (p, v) => p.id === v },
          {
            label: "Status",
            options: Array.from(new Set(maklonPOs.map((p) => maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) }).label))),
            test: (p, v) => maklonPoBadge({ ...p, status: maklonPoDisplayStatus(p, vendorInvoices) }).label === v,
          },
        ]}
        emptyText="Belum ada PO vendor produksi."
      />

      {detail && drillVendor && (
        <VendorSwitchModal
          vendorName={VENDOR_PRODUKSI[drillVendor]?.name ?? drillVendor}
          rows={aduanRowsForVendor(detail, drillVendor)}
          otherVendors={Object.keys(VENDOR_PRODUKSI)
            .filter((v) => v !== drillVendor)
            .map((v) => ({ id: v, name: VENDOR_PRODUKSI[v].name }))}
          onSwitch={(aduanId, toVendor) => switchAduanVendor(detail.mrp.id, aduanId, toVendor)}
          onClose={() => setDrillVendor(null)}
        />
      )}
    </AppShell>
  );
}
