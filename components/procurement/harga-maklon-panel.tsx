"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { EditableCell } from "@/components/mrp/editable-cell";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { HargaMaklonRow } from "@/lib/mrp/masterData";

/** Master Data — Harga Maklon (ongkos jahit per vendor produksi, bertingkat berdasarkan
 *  kapasitas). DIPAKAI LIVE oleh `hargaMaklonRateInfo`/`maklonRateExplanation` (lib/mrp/derive.ts)
 *  untuk estimasi harga PO Produksi di PO Approval (badge sumber Standar/PKS). Baris harus diklik
 *  "Edit" dulu sebelum sel-selnya jadi interaktif -- lihat state `editingId` di bawah. */
export function HargaMaklonPanel() {
  const rows = useMrpStore((s) => s.hargaMaklon);
  const addRow = useMrpStore((s) => s.addHargaMaklonRow);
  const updateRow = useMrpStore((s) => s.updateHargaMaklonRow);
  const deleteRow = useMrpStore((s) => s.deleteHargaMaklonRow);
  // Item revisi 2026-09-15 -- baris harus diklik "Edit" dulu sebelum bisa diketik (cegah salah ketik).
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns: ColumnDef<HargaMaklonRow>[] = [
    {
      // default:false — Nama Vendor sudah cukup identifikasi manusiawi; kode vendor lebih ke
      // field pencocokan teknis (lihat hargaMaklonRowMatchesVendor) — dipindah ke toggle "Kolom".
      key: "kodeVendor",
      label: "Kode Vendor",
      default: false,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.kodeVendor || "—"}>
          <input value={r.kodeVendor} onChange={(e) => updateRow(r.id, { kodeVendor: e.target.value })} className="input w-[90px]" />
        </EditableCell>
      ),
    },
    {
      key: "namaVendor",
      label: "Nama Vendor",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.namaVendor || "—"}>
          <input value={r.namaVendor} onChange={(e) => updateRow(r.id, { namaVendor: e.target.value })} className="input w-[150px]" />
        </EditableCell>
      ),
    },
    {
      key: "tipeLengan",
      label: "Tipe Lengan",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.tipeLengan || "—"}>
          <input value={r.tipeLengan} onChange={(e) => updateRow(r.id, { tipeLengan: e.target.value })} className="input w-[110px]" placeholder="PDK / PJG / Wangky PDK" />
        </EditableCell>
      ),
    },
    {
      key: "jenisHarga",
      label: "Jenis Harga",
      default: true,
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.jenisHarga}>
          <select value={r.jenisHarga} onChange={(e) => updateRow(r.id, { jenisHarga: e.target.value === "PKS" ? "PKS" : "Standar" })} className="input w-[100px]">
            <option value="Standar">Standar</option>
            <option value="PKS">PKS</option>
          </select>
        </EditableCell>
      ),
    },
    {
      key: "kapasitasMin",
      label: "Kapasitas Min",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={r.kapasitasMin != null ? r.kapasitasMin.toLocaleString("id-ID") : "—"}>
          <input
            type="number"
            value={r.kapasitasMin ?? ""}
            onChange={(e) => updateRow(r.id, { kapasitasMin: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="input w-[90px] text-right"
            placeholder="—"
          />
        </EditableCell>
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
        <EditableCell editing={editingId === r.id} display={r.kapasitasMax != null ? r.kapasitasMax.toLocaleString("id-ID") : "—"}>
          <input
            type="number"
            value={r.kapasitasMax ?? ""}
            onChange={(e) => updateRow(r.id, { kapasitasMax: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="input w-[90px] text-right"
            placeholder="—"
          />
        </EditableCell>
      ),
    },
    {
      key: "harga",
      label: "Harga",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.id} display={formatRupiah(r.harga)}>
          <NumberInput value={r.harga} onChange={(v) => updateRow(r.id, { harga: v })} currency commitOnBlurOnly className="input w-[110px] text-right" />
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
    <DataTable
      title="Harga Maklon"
      subtitle="Ongkos jahit per vendor produksi — bertingkat berdasarkan kapasitas kumulatif (Standar/PKS). DIPAKAI LIVE untuk estimasi harga PO Produksi di PO Approval (badge sumber Standar/PKS di sana)."
      headerActions={
        <Button onClick={addRow} variant="dashed" size="sm">
          + Tambah baris
        </Button>
      }
      columns={columns}
      rows={rows}
      keyOf={(r) => r.id}
      alwaysShowKey={editingId}
      firstColumnLabel="No."
      firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
      search={{ placeholder: "Cari nama/kode vendor…", getText: (r) => `${r.namaVendor} ${r.kodeVendor}` }}
      filterDefs={[
        { label: "Kode Vendor", options: Array.from(new Set(rows.map((r) => r.kodeVendor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.kodeVendor === v },
        { label: "Tipe Lengan", options: Array.from(new Set(rows.map((r) => r.tipeLengan).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id-ID")), test: (r, v) => r.tipeLengan === v },
        { label: "Jenis Harga", options: ["Standar", "PKS"], test: (r, v) => r.jenisHarga === v },
      ]}
      emptyText='Belum ada data — klik "+ Tambah baris".'
      bodyMaxHeight="60vh"
    />
  );
}
