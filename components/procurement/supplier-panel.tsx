"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";

/** Master Data — daftar TAMBAHAN nama Supplier material yang belum sempat masuk ke tab "Harga
 *  Kain". Dropdown "Vendor material" saat bikin PO (lihat app/procurement/po-approval/page.tsx,
 *  fungsi `materialSupplierNames` di lib/mrp/derive.ts) SUMBER UTAMANYA dari nama supplier unik
 *  di tab Harga Kain (otomatis ikut bertambah begitu import/edit Harga Kain) — daftar di sini
 *  cuma DIGABUNG di atasnya, untuk supplier yang perlu dipilih di PO tapi belum punya baris harga
 *  di Harga Kain. Tidak ada sheet "Supplier" terpisah dari user, jadi tidak ada tombol import
 *  di sini — murni tambah/edit/hapus manual. */
export function SupplierPanel() {
  const rows = useMrpStore((s) => s.supplierList);
  const addSupplier = useMrpStore((s) => s.addSupplier);
  const updateSupplier = useMrpStore((s) => s.updateSupplier);
  const deleteSupplier = useMrpStore((s) => s.deleteSupplier);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");

  function submitAdd() {
    const name = newName.trim();
    if (!name) return;
    addSupplier(name);
    setNewName("");
  }

  const filtered = search.trim() ? rows.filter((r) => r.nama.toLowerCase().includes(search.trim().toLowerCase())) : rows;

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <span className="font-sans text-[13px] font-semibold text-text-primary">Supplier Material (tambahan)</span>
        <span className="ml-2 font-sans text-[10.5px] font-medium text-text-muted">
          Dropdown vendor material di PO utamanya diisi dari nama supplier di tab Harga Kain — daftar ini cuma tambahan untuk supplier yang belum ada di sana.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-[#FAFBFC] px-5 py-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama supplier…"
          className="rounded-md border border-border-subtle bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-medium text-[#31414F]"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
          placeholder="Nama supplier baru…"
          className="input ml-auto flex-1 max-w-[280px]"
        />
        <Button onClick={submitAdd} variant="dashed" size="sm" disabled={!newName.trim()}>
          + Tambah
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {filtered.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-[#F1F4F7] px-5 py-2 last:border-b-0">
            <input value={r.nama} onChange={(e) => updateSupplier(r.id, e.target.value)} className="input flex-1 max-w-[320px]" />
            <Button onClick={() => deleteSupplier(r.id)} variant="danger" size="xs">
              Hapus
            </Button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-5 py-6 text-center font-sans text-xs text-text-muted">{rows.length === 0 ? "Belum ada supplier." : "Tidak ada supplier yang cocok."}</div>
        )}
      </div>
    </div>
  );
}
