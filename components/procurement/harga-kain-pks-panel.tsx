"use client";

import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { ImportSheetButton } from "@/components/mrp/import-sheet-button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { GOOGLE_SHEET_URLS, fetchGoogleSheetCsv, mapHargaKainPksRows, parseCsvRows } from "@/lib/mrp/importGoogleSheet";
import type { HargaKainPksRow } from "@/lib/mrp/masterData";

/** Master Data — Harga Kain PKS: sama seperti Harga Kain tapi bertingkat berdasarkan tonase
 *  (per SATUAN, biasanya "TON"). Aturan bisnis dari user: kalau order tidak mencapai tonaseMin
 *  manapun, pakai harga flat di tab Harga Kain — aturan ini BELUM diimplementasikan sebagai
 *  lookup otomatis di fase ini, tabel ini murni referensi yang bisa dilihat/diedit. */
export function HargaKainPksPanel() {
  const rows = useMrpStore((s) => s.hargaKainPks);
  const addRow = useMrpStore((s) => s.addHargaKainPksRow);
  const updateRow = useMrpStore((s) => s.updateHargaKainPksRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKainPksRow);
  const replaceAll = useMrpStore((s) => s.replaceHargaKainPks);

  async function handleImport() {
    const csv = await fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaKainPks);
    const parsed = mapHargaKainPksRows(parseCsvRows(csv));
    replaceAll(parsed);
    return parsed.length;
  }

  const columns: ColumnDef<HargaKainPksRow>[] = [
    {
      key: "kodeSupplier",
      label: "Kode Supplier",
      default: true,
      render: (r) => <input value={r.kodeSupplier} onChange={(e) => updateRow(r.id, { kodeSupplier: e.target.value })} className="input w-[110px]" />,
    },
    {
      // default:false — kategori SENGAJA diabaikan di lookup harga sungguhan (lihat catatan di
      // hargaKainRateInfo, lib/mrp/derive.ts), jadi bukan info inti; dibatasi ke 7 kolom total.
      key: "kategori",
      label: "Kategori",
      default: false,
      render: (r) => <input value={r.kategori} onChange={(e) => updateRow(r.id, { kategori: e.target.value })} className="input w-[110px]" />,
    },
    {
      key: "warna",
      label: "Warna",
      default: true,
      render: (r) => <input value={r.warna} onChange={(e) => updateRow(r.id, { warna: e.target.value })} className="input w-[140px]" />,
    },
    {
      // default:false — hampir selalu "TON" (jarang bervariasi), dipindah ke toggle "Kolom".
      key: "satuan",
      label: "Satuan",
      default: false,
      render: (r) => (
        <select value={r.satuan} onChange={(e) => updateRow(r.id, { satuan: e.target.value })} className="input w-[80px]">
          <option value="TON">TON</option>
          <option value="KG">KG</option>
        </select>
      ),
    },
    {
      key: "tonaseMin",
      label: "Tonase Min",
      default: true,
      align: "right",
      render: (r) => (
        <input
          type="number"
          value={r.tonaseMin ?? ""}
          onChange={(e) => updateRow(r.id, { tonaseMin: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="input w-[80px] text-right"
          placeholder="—"
        />
      ),
    },
    {
      key: "tonaseMax",
      label: "Tonase Max",
      default: true,
      align: "right",
      render: (r) => (
        <input
          type="number"
          value={r.tonaseMax ?? ""}
          onChange={(e) => updateRow(r.id, { tonaseMax: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="input w-[80px] text-right"
          placeholder="—"
        />
      ),
    },
    {
      key: "hargaPerKg",
      label: "Harga per kg",
      default: true,
      align: "right",
      render: (r) => <NumberInput value={r.hargaPerKg} onChange={(v) => updateRow(r.id, { hargaPerKg: v })} currency className="input w-[110px] text-right" />,
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <Button onClick={() => deleteRow(r.id)} variant="danger" size="xs">
          Hapus
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-4 py-2.5 font-sans text-[11px] leading-[1.5] text-info-fg">
        Harga bertingkat berdasarkan tonase — kalau order tidak mencapai tonase minimum manapun, pakai harga flat di tab{" "}
        <b>Harga Kain / Material</b> sebagai fallback. Aturan ini belum otomatis dihitung sistem, tabel ini murni referensi.
      </div>
      <DataTable
        title="Harga Kain PKS (bertingkat per tonase)"
        subtitle={`${rows.length} baris. Belum dipakai otomatis di kalkulasi PO material.`}
        headerActions={
          <div className="flex items-center gap-2">
            <Button onClick={addRow} variant="dashed" size="sm">
              + Tambah baris
            </Button>
            <ImportSheetButton onImport={handleImport} autoImportIfEmpty={rows.length === 0} />
          </div>
        }
        columns={columns}
        rows={rows}
        keyOf={(r) => r.id}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        filterDefs={[
          { label: "Kode Supplier", options: Array.from(new Set(rows.map((r) => r.kodeSupplier).filter(Boolean))), test: (r, v) => r.kodeSupplier === v },
          { label: "Kategori", options: Array.from(new Set(rows.map((r) => r.kategori).filter(Boolean))), test: (r, v) => r.kategori === v },
          { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))), test: (r, v) => r.warna === v },
        ]}
        emptyText='Belum ada data — klik "Import dari Google Sheets" atau "+ Tambah baris".'
        bodyMaxHeight="60vh"
      />
    </>
  );
}
