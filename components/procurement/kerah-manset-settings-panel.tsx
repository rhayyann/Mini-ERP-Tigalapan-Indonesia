"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { EditableCell } from "@/components/mrp/editable-cell";
import { formatRupiah } from "@/lib/mrp/derive";
import { useMrpStore } from "@/lib/mrp/store";
import type { KerahMansetSettingRow } from "@/lib/mrp/masterData";

/** Master Data — Kerah/Manset (konversi qty PCS -> kg + harga/kg, GLOBAL untuk semua warna
 *  kategori WANGKI MYNO, migration 0036). BEDA dari kolom kerah_kg/manset_kg di lengan_groups/
 *  material_rows (migration 0033, itu KG HASIL KONVERSI per warna) — tabel ini PARAMETER
 *  konversinya, DIPAKAI LIVE oleh `parseMrpImportFile` (lib/mrp/parseImport.ts) saat import MRP
 *  baru kategori WANGKI MYNO & untuk estimasi nominal Kerah/Manset di PO Approval
 *  (app/procurement/po-approval/page.tsx) — TIDAK mengubah nilai PO Bahan otomatis (Kerah/Manset
 *  tetap masuk manual lewat Add Buy di Paying Voucher seperti sekarang). SELALU PERSIS 2 baris
 *  (KERAH & MANSET) — tidak ada tombol tambah/hapus baris, cuma update 2 field per baris. */
export function KerahMansetSettingsPanel() {
  const rowsRaw = useMrpStore((s) => s.kerahMansetSettings);
  const updateRow = useMrpStore((s) => s.updateKerahMansetSetting);

  // Urutan tampil KERAH lalu MANSET — tidak terjamin dari server (order by kind di migration
  // seharusnya sudah alfabetis KERAH < MANSET, tapi tetap di-sort eksplisit di sini untuk aman).
  const rows = [...rowsRaw].sort((a, b) => (a.kind === "KERAH" ? 0 : 1) - (b.kind === "KERAH" ? 0 : 1));
  // Item revisi 2026-09-15 -- baris harus diklik "Edit" dulu sebelum bisa diketik (cegah salah
  // ketik). Kolom "Item" (Kerah/Manset) TETAP label saja, TIDAK PERNAH interaktif.
  const [editingId, setEditingId] = useState<string | null>(null);

  const columns: ColumnDef<KerahMansetSettingRow>[] = [
    {
      key: "item",
      label: "Item",
      default: true,
      render: (r) => <span className="font-sans text-[12.5px] font-medium text-text-primary">{r.kind === "KERAH" ? "Kerah" : "Manset"}</span>,
    },
    {
      key: "kgPerPcs",
      label: "Kg per Pcs",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.kind} display={r.kgPerPcs.toLocaleString("id-ID", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}>
          <NumberInput value={r.kgPerPcs} onChange={(v) => updateRow(r.kind, { kgPerPcs: v })} decimals={3} className="input w-[110px] text-right" />
        </EditableCell>
      ),
    },
    {
      key: "hargaPerKg",
      label: "Harga per Kg",
      default: true,
      align: "right",
      render: (r) => (
        <EditableCell editing={editingId === r.kind} display={formatRupiah(r.hargaPerKg)}>
          <NumberInput value={r.hargaPerKg} onChange={(v) => updateRow(r.kind, { hargaPerKg: v })} currency commitOnBlurOnly className="input w-[130px] text-right" />
        </EditableCell>
      ),
    },
    {
      key: "aksi",
      label: "Aksi",
      default: true,
      render: (r) => (
        <Button onClick={() => setEditingId(editingId === r.kind ? null : r.kind)} variant={editingId === r.kind ? "success" : "ghost"} size="xs">
          {editingId === r.kind ? "Simpan" : "Edit"}
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      title="Kerah/Manset"
      subtitle="Parameter konversi qty pcs -> kg + harga/kg untuk kebutuhan Kerah & Manset kategori WANGKI MYNO — dipakai untuk mengonversi angka di kolom Excel KERAH/MANSET saat import MRP baru, dan estimasi nominal Kerah/Manset di PO Approval. TIDAK mengubah nilai PO Bahan otomatis (tetap masuk manual lewat Add Buy di Paying Voucher)."
      columns={columns}
      rows={rows}
      keyOf={(r) => r.kind}
      search={{ placeholder: "Cari item…", getText: (r) => (r.kind === "KERAH" ? "Kerah" : "Manset") }}
      firstColumnLabel="No."
      firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
      emptyText="Data belum tersedia."
      bodyMaxHeight="60vh"
    />
  );
}
