"use client";

import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { ImportSheetButton } from "@/components/mrp/import-sheet-button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { GOOGLE_SHEET_URLS, fetchGoogleSheetCsv, mapHargaMaklonRows, parseCsvRows } from "@/lib/mrp/importGoogleSheet";
import type { HargaMaklonRow } from "@/lib/mrp/masterData";

/** Master Data — Harga Maklon (ongkos jahit per vendor produksi, bertingkat berdasarkan
 *  kapasitas). MURNI data referensi di fase ini — belum dipakai otomatis oleh kalkulasi PO/
 *  invoice manapun (lihat catatan di lib/mrp/masterData.ts). Sel-sel tabel langsung editable
 *  (onChange -> store), tidak ada tombol Simpan terpisah. */
export function HargaMaklonPanel() {
  const rows = useMrpStore((s) => s.hargaMaklon);
  const addRow = useMrpStore((s) => s.addHargaMaklonRow);
  const updateRow = useMrpStore((s) => s.updateHargaMaklonRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaMaklonRow);
  const replaceAll = useMrpStore((s) => s.replaceHargaMaklon);

  async function handleImport() {
    const csv = await fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaMaklon);
    const parsed = mapHargaMaklonRows(parseCsvRows(csv));
    replaceAll(parsed);
    return parsed.length;
  }

  const columns: ColumnDef<HargaMaklonRow>[] = [
    {
      // default:false — Nama Vendor sudah cukup identifikasi manusiawi; kode vendor lebih ke
      // field pencocokan teknis (lihat hargaMaklonRowMatchesVendor) — dipindah ke toggle "Kolom".
      key: "kodeVendor",
      label: "Kode Vendor",
      default: false,
      render: (r) => <input value={r.kodeVendor} onChange={(e) => updateRow(r.id, { kodeVendor: e.target.value })} className="input w-[90px]" />,
    },
    {
      key: "namaVendor",
      label: "Nama Vendor",
      default: true,
      render: (r) => <input value={r.namaVendor} onChange={(e) => updateRow(r.id, { namaVendor: e.target.value })} className="input w-[150px]" />,
    },
    {
      key: "tipeLengan",
      label: "Tipe Lengan",
      default: true,
      render: (r) => <input value={r.tipeLengan} onChange={(e) => updateRow(r.id, { tipeLengan: e.target.value })} className="input w-[110px]" placeholder="PDK / PJG / Wangky PDK" />,
    },
    {
      key: "jenisHarga",
      label: "Jenis Harga",
      default: true,
      render: (r) => (
        <select value={r.jenisHarga} onChange={(e) => updateRow(r.id, { jenisHarga: e.target.value === "PKS" ? "PKS" : "Standar" })} className="input w-[100px]">
          <option value="Standar">Standar</option>
          <option value="PKS">PKS</option>
        </select>
      ),
    },
    {
      key: "kapasitasMin",
      label: "Kapasitas Min",
      default: true,
      align: "right",
      render: (r) => (
        <input
          type="number"
          value={r.kapasitasMin ?? ""}
          onChange={(e) => updateRow(r.id, { kapasitasMin: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="input w-[90px] text-right"
          placeholder="—"
        />
      ),
    },
    {
      // default:false — batas atas tier sering open-ended; Kapasitas Min sudah cukup menandai
      // ambang tiernya untuk tampilan default (dibatasi 7 kolom total).
      key: "kapasitasMax",
      label: "Kapasitas Max",
      default: false,
      align: "right",
      render: (r) => (
        <input
          type="number"
          value={r.kapasitasMax ?? ""}
          onChange={(e) => updateRow(r.id, { kapasitasMax: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="input w-[90px] text-right"
          placeholder="—"
        />
      ),
    },
    {
      key: "harga",
      label: "Harga",
      default: true,
      align: "right",
      render: (r) => <NumberInput value={r.harga} onChange={(v) => updateRow(r.id, { harga: v })} currency className="input w-[110px] text-right" />,
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
    <DataTable
      title="Harga Maklon"
      subtitle="Ongkos jahit per vendor produksi — bertingkat berdasarkan kapasitas kumulatif (Standar/PKS). Belum dipakai otomatis di kalkulasi PO/invoice."
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
        { label: "Kode Vendor", options: Array.from(new Set(rows.map((r) => r.kodeVendor).filter(Boolean))), test: (r, v) => r.kodeVendor === v },
        { label: "Tipe Lengan", options: Array.from(new Set(rows.map((r) => r.tipeLengan).filter(Boolean))), test: (r, v) => r.tipeLengan === v },
        { label: "Jenis Harga", options: ["Standar", "PKS"], test: (r, v) => r.jenisHarga === v },
      ]}
      emptyText='Belum ada data — klik "Import dari Google Sheets" atau "+ Tambah baris".'
      bodyMaxHeight="60vh"
    />
  );
}
