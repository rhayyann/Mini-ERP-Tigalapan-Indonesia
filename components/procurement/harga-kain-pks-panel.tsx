"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { ImportSheetButton } from "@/components/mrp/import-sheet-button";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { EditableCell } from "@/components/mrp/editable-cell";
import { formatRupiah } from "@/lib/mrp/derive";
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
  // Item revisi 2026-09-15 -- baris harus diklik "Edit" dulu sebelum bisa diketik (cegah salah ketik).
  const [editingId, setEditingId] = useState<string | null>(null);

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
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.kodeSupplier || "—"}>
          <input value={r.kodeSupplier} onChange={(e) => updateRow(r.id, { kodeSupplier: e.target.value })} className="input w-[110px]" />
        </EditableCell>
      ),
    },
    {
      // default:false — kategori SENGAJA diabaikan di lookup harga sungguhan (lihat catatan di
      // hargaKainRateInfo, lib/mrp/derive.ts), jadi bukan info inti; dibatasi ke 7 kolom total.
      key: "kategori",
      label: "Kategori",
      default: false,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.kategori || "—"}>
          <input value={r.kategori} onChange={(e) => updateRow(r.id, { kategori: e.target.value })} className="input w-[110px]" />
        </EditableCell>
      ),
    },
    {
      key: "warna",
      label: "Warna",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.warna || "—"}>
          <input value={r.warna} onChange={(e) => updateRow(r.id, { warna: e.target.value })} className="input w-[140px]" />
        </EditableCell>
      ),
    },
    {
      // default:false — hampir selalu "TON" (jarang bervariasi), dipindah ke toggle "Kolom".
      key: "satuan",
      label: "Satuan",
      default: false,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.satuan}>
          <select value={r.satuan} onChange={(e) => updateRow(r.id, { satuan: e.target.value })} className="input w-[80px]">
            <option value="TON">TON</option>
            <option value="KG">KG</option>
          </select>
        </EditableCell>
      ),
    },
    {
      key: "tonaseMin",
      label: "Tonase Min",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.tonaseMin != null ? r.tonaseMin.toLocaleString("id-ID") : "—"}>
          <input
            type="number"
            value={r.tonaseMin ?? ""}
            onChange={(e) => updateRow(r.id, { tonaseMin: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="input w-[80px] text-right"
            placeholder="—"
          />
        </EditableCell>
      ),
    },
    {
      key: "tonaseMax",
      label: "Tonase Max",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.tonaseMax != null ? r.tonaseMax.toLocaleString("id-ID") : "—"}>
          <input
            type="number"
            value={r.tonaseMax ?? ""}
            onChange={(e) => updateRow(r.id, { tonaseMax: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="input w-[80px] text-right"
            placeholder="—"
          />
        </EditableCell>
      ),
    },
    {
      key: "hargaPerKg",
      label: "Harga per kg",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={formatRupiah(r.hargaPerKg)}>
          <NumberInput value={r.hargaPerKg} onChange={(v) => updateRow(r.id, { hargaPerKg: v })} currency commitOnBlurOnly className="input w-[110px] text-right" />
        </EditableCell>
      ),
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Button onClick={() => setEditingId(editingId === r.id ? null : r.id)} variant={editingId === r.id ? "success" : "ghost"} size="xs">
            {editingId === r.id ? "Simpan" : "Edit"}
          </Button>
          <Button onClick={() => deleteRow(r.id)} variant="danger" size="xs">
            Hapus
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
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
        alwaysShowKey={editingId}
        firstColumnLabel="No."
        firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
        search={{ placeholder: "Cari warna/supplier…", getText: (r) => `${r.warna} ${r.kodeSupplier} ${r.kategori}` }}
        filterDefs={[
          { label: "Kode Supplier", options: Array.from(new Set(rows.map((r) => r.kodeSupplier).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeSupplier === v },
          { label: "Kategori", options: Array.from(new Set(rows.map((r) => r.kategori).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kategori === v },
          { label: "Warna", options: Array.from(new Set(rows.map((r) => r.warna).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.warna === v },
        ]}
        emptyText='Belum ada data — klik "Import dari Google Sheets" atau "+ Tambah baris".'
        bodyMaxHeight="60vh"
      />
    </>
  );
}
