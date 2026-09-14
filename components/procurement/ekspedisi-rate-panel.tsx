"use client";

import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import type { EkspedisiRateRow } from "@/lib/mrp/masterData";

/** Master Data — Ekspedisi (tarif ongkir FLAT per kg). BEDA dari Harga Maklon/Harga Kain/Harga
 *  Kain PKS (masih murni data referensi, lihat catatan di lib/mrp/masterData.ts): tabel ini
 *  DIPAKAI LIVE oleh ekspedisiPrice/koliOngkirShare (lib/mrp/derive.ts) untuk menghitung ongkir
 *  yang tampil di halaman Pengiriman, Invoice Vendor, Payment Maklon, Laporan HPP, dan Penerimaan
 *  Warehouse — mengubah harga di sini LANGSUNG mengubah angka ongkir di semua tempat itu. Tidak
 *  ada import Google Sheets untuk tabel ini (beda dari panel Master Data lain). */
export function EkspedisiRatePanel() {
  const rows = useMrpStore((s) => s.ekspedisiRates);
  const addRow = useMrpStore((s) => s.addEkspedisiRateRow);
  const updateRow = useMrpStore((s) => s.updateEkspedisiRateRow);
  const deleteRow = useMrpStore((s) => s.deleteEkspedisiRateRow);

  const columns: ColumnDef<EkspedisiRateRow>[] = [
    {
      key: "nama",
      label: "Nama Ekspedisi",
      default: true,
      render: (r) => <input value={r.nama} onChange={(e) => updateRow(r.id, { nama: e.target.value })} className="input w-[220px]" />,
    },
    {
      key: "pricePerKg",
      label: "Harga/kg",
      default: true,
      align: "right",
      render: (r) => <NumberInput value={r.pricePerKg} onChange={(v) => updateRow(r.id, { pricePerKg: v })} currency commitOnBlurOnly className="input w-[130px] text-right" />,
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
      title="Ekspedisi"
      subtitle="Tarif ongkir FLAT per kg (harga/kg x total berat kg 1 resi pengiriman) — tabel ini DIPAKAI LANGSUNG untuk menghitung ongkir koli/HPP di seluruh app."
      headerActions={
        <Button onClick={addRow} variant="dashed" size="sm">
          + Tambah baris
        </Button>
      }
      columns={columns}
      rows={rows}
      keyOf={(r) => r.id}
      search={{ placeholder: "Cari nama ekspedisi…", getText: (r) => r.nama }}
      firstColumnLabel="No."
      firstColumnRender={(r) => <span className="font-mono text-[11px] text-text-muted">{rows.indexOf(r) + 1}</span>}
      emptyText='Belum ada data — klik "+ Tambah baris".'
      bodyMaxHeight="60vh"
    />
  );
}
