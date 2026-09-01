"use client";

import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { ImportSheetButton } from "@/components/mrp/import-sheet-button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { GOOGLE_SHEET_URLS, fetchGoogleSheetCsv, mapHargaKainRows, parseCsvRows } from "@/lib/mrp/importGoogleSheet";
import type { HargaKainRow } from "@/lib/mrp/masterData";

/** Master Data — Harga Kain/Material flat per kg, per supplier + kategori + warna. Bisa 468+
 *  baris (dari sheet asli) — pakai filterDefs DataTable untuk menyaring. MURNI data referensi di
 *  fase ini, belum dipakai otomatis oleh kalkulasi PO material manapun. */
export function HargaKainPanel() {
  const rows = useMrpStore((s) => s.hargaKain);
  const addRow = useMrpStore((s) => s.addHargaKainRow);
  const updateRow = useMrpStore((s) => s.updateHargaKainRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaKainRow);
  const replaceAll = useMrpStore((s) => s.replaceHargaKain);

  async function handleImport() {
    const csv = await fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.hargaKain);
    const parsed = mapHargaKainRows(parseCsvRows(csv));
    replaceAll(parsed);
    return parsed.length;
  }

  const columns: ColumnDef<HargaKainRow>[] = [
    {
      key: "kodeSupplier",
      label: "Kode Supplier",
      default: true,
      render: (r) => <input value={r.kodeSupplier} onChange={(e) => updateRow(r.id, { kodeSupplier: e.target.value })} className="input w-[110px]" />,
    },
    {
      key: "namaSupplier",
      label: "Nama Supplier",
      default: true,
      render: (r) => <input value={r.namaSupplier} onChange={(e) => updateRow(r.id, { namaSupplier: e.target.value })} className="input w-[130px]" />,
    },
    {
      key: "kategori",
      label: "Kategori",
      default: true,
      render: (r) => <input value={r.kategori} onChange={(e) => updateRow(r.id, { kategori: e.target.value })} className="input w-[110px]" />,
    },
    {
      key: "warna",
      label: "Warna",
      default: true,
      render: (r) => <input value={r.warna} onChange={(e) => updateRow(r.id, { warna: e.target.value })} className="input w-[140px]" />,
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
    <DataTable
      title="Harga Kain / Material"
      subtitle={`Harga flat per kg — ${rows.length} baris. Belum dipakai otomatis di kalkulasi PO material.`}
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
  );
}
