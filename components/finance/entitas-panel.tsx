"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImportSheetButton } from "@/components/mrp/import-sheet-button";
import { useMrpStore } from "@/lib/mrp/store";
import { GOOGLE_SHEET_URLS, fetchGoogleSheetCsv, mapEntitasRows, parseCsvRows } from "@/lib/mrp/importGoogleSheet";

/** Master Data — daftar Entitas (badan usaha) yang dipakai Procurement (assign per PO/material)
 *  & Finance (approval, pilih entitas bayar). Sebelumnya ada 2 sumber berbeda yang tidak sinkron:
 *  ENTITAS_LIST di lib/mrp/seed.ts dan konstanta ENTITIES terpisah di
 *  components/finance/po-material-panel.tsx — sekarang keduanya pakai `entitasList` di store ini
 *  sebagai satu-satunya sumber. */
export function EntitasPanel() {
  const rows = useMrpStore((s) => s.entitasList);
  const addEntitas = useMrpStore((s) => s.addEntitas);
  const updateEntitas = useMrpStore((s) => s.updateEntitas);
  const deleteEntitas = useMrpStore((s) => s.deleteEntitas);
  const replaceEntitas = useMrpStore((s) => s.replaceEntitas);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");

  async function handleImport() {
    const csv = await fetchGoogleSheetCsv(GOOGLE_SHEET_URLS.entitas);
    const parsed = mapEntitasRows(parseCsvRows(csv));
    replaceEntitas(parsed);
    return parsed.length;
  }

  function submitAdd() {
    const name = newName.trim();
    if (!name) return;
    addEntitas(name);
    setNewName("");
  }

  const filtered = search.trim() ? rows.filter((r) => r.nama.toLowerCase().includes(search.trim().toLowerCase())) : rows;

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <div>
          <span className="font-sans text-[13px] font-semibold text-text-primary">List Entitas</span>
          <div className="mt-0.5 font-sans text-[10.5px] font-medium text-text-muted">Dipakai Procurement & Finance saat assign/approve PO.</div>
        </div>
        <div className="ml-auto">
          <ImportSheetButton onImport={handleImport} autoImportIfEmpty={rows.length === 0} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama entitas…"
          className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          placeholder="Nama entitas baru…"
          className="input ml-auto flex-1 max-w-[320px]"
        />
        <Button onClick={submitAdd} variant="dashed" size="sm" disabled={!newName.trim()}>
          + Tambah
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {filtered.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-[#F1F4F7] px-5 py-2 last:border-b-0">
            <input value={r.nama} onChange={(e) => updateEntitas(r.id, e.target.value)} className="input flex-1 max-w-[360px]" />
            <Button onClick={() => deleteEntitas(r.id)} variant="danger" size="xs">
              Hapus
            </Button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">{rows.length === 0 ? "Belum ada entitas." : "Tidak ada entitas yang cocok."}</div>
        )}
      </div>
    </div>
  );
}
