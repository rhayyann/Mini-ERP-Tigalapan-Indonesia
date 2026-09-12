"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, formatRupiah, hppRowsForInvoicePerRoll, mrpMetaFor, type HppRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { DeliveryKoli } from "@/lib/mrp/types";

/** Item 2026-09-11 (user-reported: "Batch koli" cuma label bebas yang diketik vendor, TIDAK
 *  dijamin unik -- kalau 2 koli FISIK berbeda kebetulan/sengaja dinamai sama, mis. "1", 2 baris
 *  breakdown ini kelihatan seperti duplikat padahal itu 2 pengiriman beda tanggal/resi). Tambah
 *  `tanggalKirim`/`noResi` (lookup `koliId` -> DeliveryKoli, dihitung SEKALI saat membangun `rows`
 *  supaya tabel & export Excel pakai nilai yang sama persis) supaya 2 baris begitu tetap bisa
 *  dibedakan tanpa pindah ke halaman Payment Maklon > Lampiran ekspedisi. */
type HppTableRow = HppRow & { rowId: string; tanggalKirim?: string; noResi?: string };

/** Struktur agregat per vendor untuk 1 MRP -- persis rumus yang tadinya melekat langsung pada
 *  baris utama tabel (grouping key `mrpId|vendorProduksi`), sekarang jadi 1 entry di dalam
 *  `MrpHppSummary.vendors` (lihat requirement D, spec restrukturisasi Laporan HPP). */
type VendorHppSummary = {
  vendorProduksi: string;
  vendorLabel: string;
  totalFg: number;
  avgHpp: number;
  totalBiayaProduksi: number;
  totalCogsBahan: number;
  totalOngkir: number;
  itemRows: HppTableRow[];
};

/** Baris utama tabel sekarang 1 MRP = 1 baris (bukan lagi 1 MRP+vendor) -- `vendors` menampung
 *  breakdown per vendor produksi untuk drill-down langkah-1, sementara `itemRows`/`totalFg`/dst di
 *  level ini adalah agregat gabungan SEMUA vendor MRP tsb (dihitung ulang dari gabungan itemRows,
 *  BUKAN rata-rata dari rata-rata vendor -- lihat requirement D butir 14 di spec). */
type MrpHppSummary = {
  mrpId: string;
  mrpLabel: string;
  vendors: VendorHppSummary[];
  totalFg: number;
  avgHpp: number;
  totalBiayaProduksi: number;
  totalCogsBahan: number;
  totalOngkir: number;
  itemRows: HppTableRow[];
};

/** Sorting requirement D butir 20 -- batch/resi vendor tsb bisa lebih dari satu (vendor kirim
 *  beberapa resi/koli terpisah untuk 1 MRP), urutkan supaya baris yang sama noResi-nya
 *  mengelompok: noResi (baris tanpa resi paling bawah), lalu tanggalKirim, noKoli, warna, lengan,
 *  item. Tidak ada header grup/subtotal per resi (non-goal, lihat spec). */
function sortHppRowsForDetail(rows: HppTableRow[]): HppTableRow[] {
  return [...rows].sort((a, b) => {
    const noResiA = a.noResi ?? "";
    const noResiB = b.noResi ?? "";
    if (!noResiA && noResiB) return 1;
    if (noResiA && !noResiB) return -1;
    if (noResiA !== noResiB) return noResiA < noResiB ? -1 : 1;
    const tglA = a.tanggalKirim ?? "";
    const tglB = b.tanggalKirim ?? "";
    if (tglA !== tglB) return tglA < tglB ? -1 : 1;
    const koliA = a.noKoli ?? "";
    const koliB = b.noKoli ?? "";
    if (koliA !== koliB) return koliA < koliB ? -1 : 1;
    if (a.warna !== b.warna) return a.warna < b.warna ? -1 : 1;
    if (a.lengan !== b.lengan) return a.lengan < b.lengan ? -1 : 1;
    if (a.item !== b.item) return a.item < b.item ? -1 : 1;
    return 0;
  });
}

/** Item 2026-09-11 (feedback: "Tambahkan fitur download lampiran HPP (Per no MRP)") -- export
 *  Excel dari `itemRows` (HppRow[], SUDAH dihitung lewat hppRowsForInvoicePerRoll -- granularitas
 *  per roll/koli, lebih detail dari lampiran invoice lama di Procurement) untuk 1 MRP (gabungan
 *  SEMUA vendor MRP itu, requirement D butir 21), TANPA menghitung ulang apa pun -- pola export
 *  SAMA PERSIS `exportInvoiceLampiranExcel`/`downloadInvoiceLampiran` di
 *  components/procurement/invoice-vendor-review-panel.tsx (SheetJS json_to_sheet + writeFile),
 *  cuma sumber datanya beda (baris HPP per MRP di halaman ini, bukan per invoice). Kolom pertama
 *  `VENDOR` ditambahkan (sebelum `MRP`) supaya baris antar-vendor tetap bisa dibedakan di sheet
 *  gabungan; urutan baris = vendor alfabetis lalu sorting per-resi (sortHppRowsForDetail). */
function exportMrpHppExcel(m: MrpHppSummary): XLSX.WorkSheet {
  const vendorsSorted = [...m.vendors].sort((a, b) => (a.vendorLabel < b.vendorLabel ? -1 : a.vendorLabel > b.vendorLabel ? 1 : 0));
  const orderedRows = vendorsSorted.flatMap((v) => sortHppRowsForDetail(v.itemRows));
  const rows = orderedRows.map((d) => ({
    VENDOR: VENDOR_PRODUKSI[d.vendorProduksi]?.name ?? d.vendorProduksi,
    MRP: d.mrpLabel,
    "WARNA / LENGAN": `${d.warna} · ${d.lengan}`,
    ITEM: d.item,
    "BATCH KOLI": d.noKoli ?? "—",
    "TANGGAL KIRIM": d.tanggalKirim ? formatDate(d.tanggalKirim) : "—",
    "NO RESI": d.noResi ?? "—",
    FG: d.fg,
    REJECT: d.reject,
    REWORK: d.rework,
    "YIELD (%)": Number(d.yieldPct.toFixed(1)),
    "BIAYA PRODUKSI/ITEM": Math.round(d.biayaProduksiPerItem),
    "COGS BAHAN/ITEM": Math.round(d.cogsBahanPerItem),
    "ONGKIR/ITEM": Math.round(d.ongkirPerItem),
    "HPP/ITEM": Math.round(d.hppPerItem),
  }));
  return XLSX.utils.json_to_sheet(rows);
}

function downloadMrpHpp(m: MrpHppSummary) {
  const wb = XLSX.utils.book_new();
  const ws = exportMrpHppExcel(m);
  XLSX.utils.book_append_sheet(wb, ws, "HPP");
  XLSX.writeFile(wb, `HPP-${m.mrpId}.xlsx`);
}

/** Tabel detail per item untuk 1 MRP+vendor — dipakai sebagai isi langkah-2 drill-down (pola sama
 *  seperti dropdown MRP di PPIC/SCM). "Item yang dihitung" mencakup FG maupun Rework — kolom
 *  Rework ditampilkan eksplisit di samping FG (pcs hasil rework yang MENDARAT di lengan/size yang
 *  sama seperti baris invoice aslinya sudah otomatis ikut kehitung sebagai bagian dari FG).
 *  Kolom "Batch Koli" (feedback 2026-09-09: "saya ingin ada ... batch pengiriman") menunjukkan
 *  koli pengiriman spesifik asal baris ini — kosong untuk baris pool lama (MRP tanpa roll
 *  tracking sama sekali) yang menggabungkan >1 koli sekaligus, lihat HppRow.noKoli. Rows di-sort
 *  (requirement D butir 20) sebelum dirender supaya batch/resi berbeda mengelompok rapi. */
function MrpHppDetailTable({ rows }: { rows: HppTableRow[] }) {
  const sortedRows = sortHppRowsForDetail(rows);
  return (
    <div className="overflow-x-auto rounded-md border border-[#E4E9EE] bg-white">
      <table className="w-full min-w-[1180px] border-collapse">
        <thead>
          <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="px-3 py-2 text-left">Warna / lengan</th>
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-3 py-2 text-left">Batch koli</th>
            <th className="px-3 py-2 text-left">Tanggal kirim</th>
            <th className="px-3 py-2 text-left">No resi</th>
            <th className="px-3 py-2 text-right">FG</th>
            <th className="px-3 py-2 text-right">Reject</th>
            <th className="px-3 py-2 text-right">Rework</th>
            <th className="px-3 py-2 text-right">Yield</th>
            <th className="px-3 py-2 text-right">Biaya Produksi/Item</th>
            <th className="px-3 py-2 text-right">COGS Bahan/Item</th>
            <th className="px-3 py-2 text-right">Ongkir/Item</th>
            <th className="px-3 py-2 text-right">HPP/Item</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.rowId} className="border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0">
              <td className="px-3 py-1.5">
                {r.warna} · {r.lengan}
              </td>
              <td className="px-3 py-1.5">{r.item}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted">{r.noKoli ?? "—"}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted">{r.tanggalKirim ? formatDate(r.tanggalKirim) : "—"}</td>
              <td className="px-3 py-1.5 font-mono text-text-muted">{r.noResi ?? "—"}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(r.fg)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(r.reject)}</td>
              <td className="px-3 py-1.5 text-right font-mono text-rework-fg">{formatPcs(r.rework)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.yieldPct.toFixed(1)}%</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(r.biayaProduksiPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(r.cogsBahanPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(r.ongkirPerItem)}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold text-text-primary">{formatRupiah(r.hppPerItem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Drill-down 2 langkah (requirement D butir 19) — state lokal per baris MRP (di dalam
 *  `renderExpanded`, `components/mrp/data-table.tsx` TIDAK mendukung nested expand & tidak boleh
 *  diubah untuk task ini). Langkah 1: daftar vendor produksi MRP ini (urut alfabetis by
 *  vendorLabel), klik salah satu -> langkah 2: `MrpHppDetailTable` untuk vendor itu + tombol
 *  kembali. Default TIDAK auto-select walau cuma 1 vendor -- alur selalu 2 langkah. Collapse lalu
 *  expand ulang mereset state ini ke langkah 1 karena komponen di-unmount/mount ulang oleh
 *  DataTable. */
function MrpVendorDrilldown({ mrp }: { mrp: MrpHppSummary }) {
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);

  const vendorsSorted = [...mrp.vendors].sort((a, b) => (a.vendorLabel < b.vendorLabel ? -1 : a.vendorLabel > b.vendorLabel ? 1 : 0));
  const selected = selectedVendor ? vendorsSorted.find((v) => v.vendorProduksi === selectedVendor) : undefined;

  if (selected) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSelectedVendor(null)}
            className="font-sans text-[11px] font-semibold text-brand-fg hover:underline"
          >
            ← Ganti vendor
          </button>
          <span className="font-sans text-[11.5px] font-semibold text-text-primary">{selected.vendorLabel}</span>
        </div>
        <MrpHppDetailTable rows={selected.itemRows} />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[#E4E9EE] bg-white">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr className="border-b border-[#E4E9EE] bg-[#F2F5F8] font-sans text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="px-3 py-2 text-left">Vendor Produksi</th>
            <th className="px-3 py-2 text-right">Total FG</th>
            <th className="px-3 py-2 text-right">Rata-rata HPP/pc</th>
          </tr>
        </thead>
        <tbody>
          {vendorsSorted.map((v) => (
            <tr
              key={v.vendorProduksi}
              onClick={() => setSelectedVendor(v.vendorProduksi)}
              className="cursor-pointer border-b border-[#EEF1F4] font-sans text-[11.5px] text-[#31414F] last:border-b-0 hover:bg-[#F7F9FB]"
            >
              <td className="px-3 py-1.5 font-semibold text-text-primary">{v.vendorLabel}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatPcs(v.totalFg)}</td>
              <td className="px-3 py-1.5 text-right font-mono">{formatRupiah(v.avgHpp)}</td>
            </tr>
          ))}
          {vendorsSorted.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center font-sans text-[11.5px] text-text-muted">
                Belum ada vendor untuk MRP ini.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function FinanceLaporanHppPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const staticMrps = useMrpStore((s) => s.staticMrps);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const rawInvoices = useMrpStore((s) => s.invoices);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);

  if (!mounted) return null;

  // Invoice REVISION belum final (masih diperbaiki vendor) jadi tidak diikutkan hitung HPP.
  const relevantInvoices = vendorInvoices.filter((i) => i.status !== "REVISION");

  // Revisi 2026-09-07 (HPP per roll) -- hppRowsForInvoicePerRoll menelusuri biaya sampai ke roll
  // fisik spesifik (harga bahan roll itu sendiri + ongkir per BATCH pengiriman dari portal Vendor
  // Produksi, lihat DeliveryKoli.ongkirBatch) untuk grup warna/lengan yang sudah pakai "Tutup
  // Roll" -- lalu fallback OTOMATIS ke perhitungan pool lama (dengan ongkir auto-hitung tarif
  // ekspedisi seperti sebelumnya) per baris invoice yang grupnya belum py roll ber-closedAt (MRP
  // lama, sebelum fitur ini ada), jadi histori tidak hilang/kosong.
  const kolisById = new Map<string, DeliveryKoli>(deliveryKolis.map((k) => [k.id, k]));
  const rows: HppTableRow[] = relevantInvoices.flatMap((inv) =>
    hppRowsForInvoicePerRoll(inv, relevantInvoices, mrpDetails, staticMrps, productionBatches, productionResults, productionGroupMeta, rawInvoices, deliveryKolis).map((r, i) => {
      const koli = r.koliId ? kolisById.get(r.koliId) : undefined;
      return { ...r, rowId: inv.id + "-" + i, tanggalKirim: koli?.deliveredAt, noResi: koli?.noResi };
    })
  );

  const totalFg = rows.reduce((s, r) => s + r.fg, 0);
  const totalBiayaProduksi = rows.reduce((s, r) => s + r.biayaProduksiTotal, 0);
  const totalCogsBahan = rows.reduce((s, r) => s + r.cogsBahan, 0);
  const totalOngkir = rows.reduce((s, r) => s + r.totalOngkirRow, 0);
  const totalHppWeighted = rows.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
  const avgHpp = totalFg > 0 ? totalHppWeighted / totalFg : 0;

  // Restrukturisasi (requirement D): sebelumnya 1 baris = 1 pasangan MRP+vendor. Sekarang grouping
  // per MRP+vendor DIPERTAHANKAN dulu (logika di bawah ini identik dengan sebelumnya, angka per
  // vendor tidak berubah) untuk membangun `VendorHppSummary`, lalu di-roll-up ke `MrpHppSummary`
  // (1 baris = 1 MRP, `vendors[]` untuk drill-down langkah-1).
  const vendorMap = new Map<string, VendorHppSummary & { mrpId: string; mrpLabel: string }>();
  for (const r of rows) {
    const key = r.mrpId + "|" + r.vendorProduksi;
    const cur = vendorMap.get(key) ?? {
      mrpId: r.mrpId,
      mrpLabel: r.mrpLabel,
      vendorProduksi: r.vendorProduksi,
      vendorLabel: VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi,
      totalFg: 0,
      avgHpp: 0,
      totalBiayaProduksi: 0,
      totalCogsBahan: 0,
      totalOngkir: 0,
      itemRows: [] as HppTableRow[],
    };
    cur.totalFg += r.fg;
    cur.totalBiayaProduksi += r.biayaProduksiTotal;
    cur.totalCogsBahan += r.cogsBahan;
    cur.totalOngkir += r.totalOngkirRow;
    cur.itemRows.push(r);
    vendorMap.set(key, cur);
  }
  const vendorRowsFromHpp = Array.from(vendorMap.values()).map((m) => {
    const weighted = m.itemRows.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
    return { ...m, avgHpp: m.totalFg > 0 ? weighted / m.totalFg : 0 };
  });

  /** Fallback REVISION-only (dipertahankan dari versi sebelumnya, requirement D butir 15): kalau
   *  pasangan MRP+vendor HANYA punya invoice REVISION (tidak ada invoice lain sama sekali),
   *  pasangan itu tidak pernah masuk `rows` (karena `relevantInvoices` di atas memfilter REVISION)
   *  -- jadi vendor itu tidak pernah muncul di langkah-1 drill-down padahal Finance perlu tahu
   *  MRP tsb "ada" (lagi ditunggu vendor revisi). Di sini gabungkan pasangan dari
   *  `vendorRowsFromHpp` (TIDAK diubah) dengan pasangan dari SELURUH `vendorInvoices` (termasuk
   *  REVISION) -- 1 invoice bisa punya lines dari >1 mrpId, jadi invoice itu relevan untuk SETIAP
   *  pasangan mrpId+vendorProduksi yang muncul di lines-nya. Untuk pasangan yang belum ada,
   *  buat entry baru dengan agregat di-nol-kan (TIDAK ikut dijumlah ke KPI cards di atas -- KPI
   *  dihitung dari `rows`, bukan dari sini) supaya vendor itu tetap muncul di langkah-1 walau
   *  belum ada angka. */
  const vendorRowsMap = new Map<string, VendorHppSummary & { mrpId: string; mrpLabel: string }>(vendorRowsFromHpp.map((m) => [m.mrpId + "|" + m.vendorProduksi, m]));
  for (const inv of vendorInvoices) {
    const mrpIdsInInvoice = Array.from(new Set(inv.lines.map((l) => l.mrpId)));
    for (const mrpId of mrpIdsInInvoice) {
      const key = mrpId + "|" + inv.vendorProduksi;
      if (vendorRowsMap.has(key)) continue;
      const mrp = mrpMetaFor(mrpId, mrpDetails, staticMrps);
      vendorRowsMap.set(key, {
        mrpId,
        mrpLabel: `${mrpId} ${mrp?.kategori ?? ""}`.trim(),
        vendorProduksi: inv.vendorProduksi,
        vendorLabel: VENDOR_PRODUKSI[inv.vendorProduksi]?.name ?? inv.vendorProduksi,
        totalFg: 0,
        avgHpp: 0,
        totalBiayaProduksi: 0,
        totalCogsBahan: 0,
        totalOngkir: 0,
        itemRows: [],
      });
    }
  }

  // Roll-up ke 1 baris per MRP -- agregat gabungan dihitung ULANG dari `itemRows` gabungan semua
  // vendor MRP itu (avgHpp weighted dari seluruh baris, BUKAN rata-rata dari rata-rata vendor,
  // lihat rumus di spec).
  const mrpMap = new Map<string, MrpHppSummary>();
  for (const v of vendorRowsMap.values()) {
    const cur = mrpMap.get(v.mrpId) ?? {
      mrpId: v.mrpId,
      mrpLabel: v.mrpLabel,
      vendors: [] as VendorHppSummary[],
      totalFg: 0,
      avgHpp: 0,
      totalBiayaProduksi: 0,
      totalCogsBahan: 0,
      totalOngkir: 0,
      itemRows: [] as HppTableRow[],
    };
    cur.vendors.push({
      vendorProduksi: v.vendorProduksi,
      vendorLabel: v.vendorLabel,
      totalFg: v.totalFg,
      avgHpp: v.avgHpp,
      totalBiayaProduksi: v.totalBiayaProduksi,
      totalCogsBahan: v.totalCogsBahan,
      totalOngkir: v.totalOngkir,
      itemRows: v.itemRows,
    });
    cur.itemRows = cur.itemRows.concat(v.itemRows);
    mrpMap.set(v.mrpId, cur);
  }
  const mrpRows: MrpHppSummary[] = Array.from(mrpMap.values()).map((m) => {
    const weighted = m.itemRows.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
    const totalFg = m.itemRows.reduce((s, r) => s + r.fg, 0);
    return {
      ...m,
      totalFg,
      totalBiayaProduksi: m.itemRows.reduce((s, r) => s + r.biayaProduksiTotal, 0),
      totalCogsBahan: m.itemRows.reduce((s, r) => s + r.cogsBahan, 0),
      totalOngkir: m.itemRows.reduce((s, r) => s + r.totalOngkirRow, 0),
      avgHpp: totalFg > 0 ? weighted / totalFg : 0,
    };
  });

  /** Ringkasan kolom "Vendor Produksi" di baris utama (requirement D butir 17): 0 vendor -> "—",
   *  1 vendor -> nama vendor itu, ≥2 vendor -> "{n} vendor · nama1, nama2, …" (alfabetis supaya
   *  stabil antar-render). */
  function vendorSummaryLabel(m: MrpHppSummary): string {
    if (m.vendors.length === 0) return "—";
    const names = [...m.vendors].map((v) => v.vendorLabel).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (names.length === 1) return names[0];
    return `${names.length} vendor · ${names.join(", ")}`;
  }

  const mrpColumns: ColumnDef<MrpHppSummary>[] = [
    { key: "vendor", label: "Vendor Produksi", default: true, render: (m) => vendorSummaryLabel(m) },
    { key: "totalFg", label: "Total FG", default: true, align: "right", render: (m) => formatPcs(m.totalFg) },
    { key: "avgHpp", label: "Rata-rata HPP/pc", default: true, align: "right", render: (m) => formatRupiah(m.avgHpp) },
    { key: "biayaProduksi", label: "Total Biaya Produksi", default: true, align: "right", render: (m) => formatRupiah(m.totalBiayaProduksi) },
    { key: "cogsBahan", label: "Total COGS Bahan", default: true, align: "right", render: (m) => formatRupiah(m.totalCogsBahan) },
    { key: "ongkir", label: "Total Ongkir", default: true, align: "right", render: (m) => formatRupiah(m.totalOngkir) },
    {
      key: "download",
      label: "Laporan",
      default: true,
      render: (m) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button onClick={() => downloadMrpHpp(m)} variant="ghost" size="xs">
            Download
          </Button>
        </span>
      ),
    },
  ];

  return (
    <AppShell
      role="finance"
      activeHref="/finance/laporan-hpp"
      breadcrumb={["Dashboard", "Laporan HPP"]}
      title="Laporan HPP"
      subtitle="Harga pokok penjualan per item — biaya produksi (maklon) + COGS bahan + ongkir (otomatis dari data delivery), dari invoice vendor yang sudah diajukan"
    >
      <div className="grid grid-cols-4 gap-3.5">
        <KpiCard label="Total FG" value={formatPcs(totalFg)} sub="pcs terhitung HPP" accent="blue" />
        <KpiCard label="Rata-rata HPP/pc" value={formatRupiah(avgHpp)} accent="purple" />
        <KpiCard label="Total biaya produksi" value={formatRupiah(totalBiayaProduksi)} sub="maklon + denda/reward" accent="orange" />
        <KpiCard label="Total COGS bahan" value={formatRupiah(totalCogsBahan)} sub={`+ ${formatRupiah(totalOngkir)} ongkir (otomatis)`} accent="teal" />
      </div>

      <DataTable
        title="Laporan HPP per MRP"
        subtitle="Klik baris untuk pilih vendor produksi, lalu lihat rincian per item"
        columns={mrpColumns}
        rows={mrpRows}
        keyOf={(m) => m.mrpId}
        firstColumnLabel="No. MRP"
        firstColumnRender={(m) => <span className="font-mono">{m.mrpLabel || m.mrpId}</span>}
        renderExpanded={(m) => <MrpVendorDrilldown mrp={m} />}
        emptyText="Belum ada data HPP — buat invoice vendor dulu di halaman Invoice Vendor."
      />
    </AppShell>
  );
}
