"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/shell/app-shell";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatDate, formatPcs, formatRupiah, hppRowsForInvoicePerRoll, type HppRow } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { DeliveryKoli } from "@/lib/mrp/types";

/** Item 2026-09-11 (user-reported: "Batch koli" cuma label bebas yang diketik vendor, TIDAK
 *  dijamin unik -- kalau 2 koli FISIK berbeda kebetulan/sengaja dinamai sama, mis. "1", 2 baris
 *  breakdown ini kelihatan seperti duplikat padahal itu 2 pengiriman beda tanggal/resi). Tambah
 *  `tanggalKirim`/`noResi` (lookup `koliId` -> DeliveryKoli, dihitung SEKALI saat membangun `rows`
 *  supaya tabel & export Excel pakai nilai yang sama persis) supaya 2 baris begitu tetap bisa
 *  dibedakan tanpa pindah ke halaman Payment Maklon > Lampiran ekspedisi. */
type HppTableRow = HppRow & { rowId: string; tanggalKirim?: string; noResi?: string };

/** Item 2026-09-11 (feedback: "Tambahkan fitur download lampiran HPP (Per no MRP)") -- export
 *  Excel dari `itemRows` (HppRow[], SUDAH dihitung lewat hppRowsForInvoicePerRoll -- granularitas
 *  per roll/koli, lebih detail dari lampiran invoice lama di Procurement) untuk 1 baris
 *  MRP+vendor, TANPA menghitung ulang apa pun -- pola export SAMA PERSIS
 *  `exportInvoiceLampiranExcel`/`downloadInvoiceLampiran` di
 *  components/procurement/invoice-vendor-review-panel.tsx (SheetJS json_to_sheet + writeFile),
 *  cuma sumber datanya beda (baris HPP per MRP di halaman ini, bukan per invoice). */
function exportMrpHppExcel(m: MrpHppSummary): XLSX.WorkSheet {
  const rows = m.itemRows.map((d) => ({
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
  XLSX.writeFile(wb, `HPP-${m.mrpId}-${m.vendorProduksi}.xlsx`);
}

type MrpHppSummary = {
  mrpId: string;
  mrpLabel: string;
  vendorProduksi: string;
  vendorLabel: string;
  totalFg: number;
  avgHpp: number;
  totalBiayaProduksi: number;
  totalCogsBahan: number;
  totalOngkir: number;
  itemRows: HppTableRow[];
};

/** Tabel detail per item untuk 1 MRP+vendor — dipakai sebagai isi expand baris MRP (pola sama
 *  seperti dropdown MRP di PPIC/SCM). "Item yang dihitung" mencakup FG maupun Rework — kolom
 *  Rework ditampilkan eksplisit di samping FG (pcs hasil rework yang MENDARAT di lengan/size yang
 *  sama seperti baris invoice aslinya sudah otomatis ikut kehitung sebagai bagian dari FG).
 *  Kolom "Batch Koli" (feedback 2026-09-09: "saya ingin ada ... batch pengiriman") menunjukkan
 *  koli pengiriman spesifik asal baris ini — kosong untuk baris pool lama (MRP tanpa roll
 *  tracking sama sekali) yang menggabungkan >1 koli sekaligus, lihat HppRow.noKoli. */
function MrpHppDetailTable({ rows }: { rows: HppTableRow[] }) {
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
          {rows.map((r) => (
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

  // Restrukturisasi: list MRP+vendor dulu (1 baris = 1 MRP+vendor, angka teragregasi), klik buat
  // expand ke tabel detail seluruh item grup itu — sebelumnya langsung 1 tabel flat semua item
  // semua MRP. Item feedback 2026-09-09 ("Di PO ini mengakomodir atau mengumpulkan data dari
  // berbagai vendor produksi kan?"): BENAR -- 1 MRP/PO Produksi bisa dipecah ke lebih dari 1
  // vendor (lihat aduanRows per warna/lengan, lib/mrp/derive.ts) -- dulu grouping cuma pakai
  // mrpId, jadi kalau 1 MRP punya >1 vendor angkanya keblend jadi 1 baris tanpa ada cara
  // membedakan mana punya vendor mana. Sekarang di-group per (mrpId + vendorProduksi).
  const mrpMap = new Map<string, MrpHppSummary>();
  for (const r of rows) {
    const key = r.mrpId + "|" + r.vendorProduksi;
    const cur = mrpMap.get(key) ?? {
      mrpId: r.mrpId,
      mrpLabel: r.mrpLabel,
      vendorProduksi: r.vendorProduksi,
      vendorLabel: VENDOR_PRODUKSI[r.vendorProduksi]?.name ?? r.vendorProduksi,
      totalFg: 0,
      avgHpp: 0,
      totalBiayaProduksi: 0,
      totalCogsBahan: 0,
      totalOngkir: 0,
      itemRows: [],
    };
    cur.totalFg += r.fg;
    cur.totalBiayaProduksi += r.biayaProduksiTotal;
    cur.totalCogsBahan += r.cogsBahan;
    cur.totalOngkir += r.totalOngkirRow;
    cur.itemRows.push(r);
    mrpMap.set(key, cur);
  }
  const mrpRows: MrpHppSummary[] = Array.from(mrpMap.values()).map((m) => {
    const weighted = m.itemRows.reduce((s, r) => s + r.hppPerItem * r.fg, 0);
    return { ...m, avgHpp: m.totalFg > 0 ? weighted / m.totalFg : 0 };
  });

  const mrpColumns: ColumnDef<MrpHppSummary>[] = [
    { key: "vendor", label: "Vendor Produksi", default: true, render: (m) => m.vendorLabel },
    { key: "totalFg", label: "Total FG", default: true, align: "right", render: (m) => formatPcs(m.totalFg) },
    { key: "avgHpp", label: "Rata-rata HPP/pc", default: true, align: "right", render: (m) => formatRupiah(m.avgHpp) },
    { key: "biayaProduksi", label: "Total Biaya Produksi", default: true, align: "right", render: (m) => formatRupiah(m.totalBiayaProduksi) },
    { key: "cogsBahan", label: "Total COGS Bahan", default: true, align: "right", render: (m) => formatRupiah(m.totalCogsBahan) },
    { key: "ongkir", label: "Total Ongkir", default: true, align: "right", render: (m) => formatRupiah(m.totalOngkir) },
    {
      key: "download",
      label: "Lampiran",
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
        subtitle="Klik baris untuk lihat rincian per item (warna/lengan/size)"
        columns={mrpColumns}
        rows={mrpRows}
        keyOf={(m) => m.mrpId + "|" + m.vendorProduksi}
        firstColumnLabel="No. MRP"
        firstColumnRender={(m) => <span className="font-mono">{m.mrpLabel || m.mrpId}</span>}
        renderExpanded={(m) => <MrpHppDetailTable rows={m.itemRows} />}
        emptyText="Belum ada data HPP — buat invoice vendor dulu di halaman Invoice Vendor."
      />
    </AppShell>
  );
}
