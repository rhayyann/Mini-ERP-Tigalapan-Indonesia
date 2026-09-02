"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatPcs, formatRupiah, maklonFeeForColorLine, materialPoFullStatus, materialPoFullStatusBadge } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { MaterialPO } from "@/lib/mrp/types";

/** Panel "PO Material" — konten diekstrak dari halaman lama /finance/po-material,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/po-approval. */
export function PoMaterialPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const materialPOs = useMrpStore((s) => s.materialPOs);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  // Dipakai buat status gabungan (materialPoFullStatus) — BUKAN po.status mentah, yang cuma
  // pernah diisi "WAITING_INVOICE" saat PO dibuat dan tidak pernah di-update lagi (lihat
  // sendPoToFinance di lib/mrp/store.ts). Sebelumnya kolom Status di sini pakai po.status mentah
  // itu langsung, jadi PO Material yang sudah lunas/delivery/selesai di halaman Procurement tetap
  // kelihatan "WAITING INVOICE" selamanya di sini — status modul Procurement benar, tapi yang
  // "dilempar" ke Finance tidak pernah berubah. Sekarang pakai fungsi status gabungan yang sama
  // dengan Procurement (material-tracking, po-approval).
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  // Dulu ada konstanta ENTITIES lokal terpisah di sini (["PT Garmen Nusantara", "PT Adikarya"])
  // yang TIDAK SINKRON dengan ENTITAS_LIST di lib/mrp/seed.ts (daftar entitas berbeda!) — sekarang
  // keduanya pakai entitasList di store sebagai satu-satunya sumber (lihat Master Data > Finance).
  const entitasList = useMrpStore((s) => s.entitasList);
  const approveMaterialPo = useMrpStore((s) => s.approveMaterialPo);
  const setMaterialPoEntity = useMrpStore((s) => s.setMaterialPoEntity);
  const setMaterialPoColorEntity = useMrpStore((s) => s.setMaterialPoColorEntity);

  const [selectedMrpId, setSelectedMrpId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Notifikasi sesaat saat user coba centang PO yang belum punya entitas — bukan cuma tooltip
  // hover (title attr) yang sering tidak kelihatan, tapi pesan yang muncul begitu diklik.
  const [entityHintPoId, setEntityHintPoId] = useState<string | null>(null);

  // Entitas sekarang disimpan PER WARNA (po.colorBreakdown[].entitas) — bukan cuma per PO — jadi
  // "sudah pilih entitas" dicek langsung dari data itu (bukan state lokal terpisah yang gampang
  // desync). Satu PO bisa gabung sampai puluhan warna (dari supplier+vendor produksi yang sama),
  // dan tiap warna BISA beda entitas — lihat dropdown per-baris di bawah. setMaterialPoEntity
  // (dropdown di header PO) tetap ada sebagai cara cepat "set semua warna PO ini ke entitas X
  // sekaligus", baru warna yang perlu beda di-override satu-satu lewat dropdown per-baris —
  // splitMaterialPoByEntitas otomatis memecah PO jadi beberapa PO approved terpisah per entitas
  // begitu approve, jadi tidak perlu approve manual per grup entitas.
  function poHasAllEntitas(po: MaterialPO) {
    return po.colorBreakdown.every((c) => !!c.entitas);
  }
  function poBulkEntitasValue(po: MaterialPO) {
    // JANGAN filter dulu sebelum cek distinctness — kalau di-filter Boolean duluan, warna yang
    // BELUM dipilih entitasnya (undefined) jadi tidak ikut dihitung, jadi dropdown bulk bisa
    // salah nunjuk "sudah terisi 1 entitas" padahal masih ada warna lain yang kosong.
    const distinct = new Set(po.colorBreakdown.map((c) => c.entitas ?? ""));
    if (distinct.size !== 1) return "";
    const only = Array.from(distinct)[0];
    return only || "";
  }

  const openPOs = materialPOs.filter((po) => po.status !== "CANCELLED");
  const pending = openPOs.filter((po) => !po.approved);
  const approved = openPOs.filter((po) => po.approved);

  const pendingMrpIds = Array.from(new Set(pending.map((p) => p.mrpId)));
  const selectable = mrpDetails.filter((d) => pendingMrpIds.includes(d.mrp.id));

  useEffect(() => {
    if (mounted && (!selectedMrpId || !pendingMrpIds.includes(selectedMrpId))) {
      setSelectedMrpId(pendingMrpIds[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, pendingMrpIds.join(",")]);

  if (!mounted) return null;

  const detail = mrpDetails.find((d) => d.mrp.id === selectedMrpId);
  const scopedPending = pending.filter((p) => p.mrpId === selectedMrpId);
  const withoutEntity = scopedPending.filter((p) => !poHasAllEntitas(p)).length;

  const grouped = new Map<string, MaterialPO[]>();
  for (const po of scopedPending) {
    const arr = grouped.get(po.vendorProduksi) ?? [];
    arr.push(po);
    grouped.set(po.vendorProduksi, arr);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVendorGroup(pos: MaterialPO[]) {
    const selectablePos = pos.filter((p) => poHasAllEntitas(p));
    const allChecked = selectablePos.length > 0 && selectablePos.every((p) => selected.has(p.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of selectablePos) {
        if (allChecked) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  function chooseEntityBulk(poId: string, entitas: string) {
    if (entitas) setMaterialPoEntity(poId, entitas);
    if (entityHintPoId === poId) setEntityHintPoId(null);
  }

  function chooseEntityForColor(poId: string, warna: string, lengan: MaterialPO["lengan"], entitas: string) {
    if (!entitas) return;
    setMaterialPoColorEntity(poId, warna, lengan, entitas);
    if (entityHintPoId === poId) setEntityHintPoId(null);
  }

  function toggleWithEntityGuard(po: MaterialPO) {
    if (!poHasAllEntitas(po)) {
      setEntityHintPoId(po.id);
      return;
    }
    setEntityHintPoId(null);
    toggle(po.id);
  }

  function approveSelected() {
    selected.forEach((id) => approveMaterialPo(id));
    setSelected(new Set());
  }

  const approvedColumns: ColumnDef<MaterialPO>[] = [
    { key: "noPo", label: "No PO", default: true, render: (p) => <span className="font-mono font-medium">{p.id}</span> },
    { key: "vendor", label: "Supplier / vendor", default: true, render: (p) => `${p.supplier} → ${VENDOR_PRODUKSI[p.vendorProduksi]?.name ?? p.vendorProduksi}` },
    { key: "roll", label: "Roll", default: true, align: "right", render: (p) => p.rollCount + " roll" },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (p) => formatRupiah(p.amount) },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (p) => {
        const badge = materialPoFullStatusBadge(materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs));
        return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
      },
    },
  ];

  return (
    <>
      {entitasList.length === 0 && (
        <div className="rounded-lg border border-[#F0DFC2] bg-warning-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-warning-fg">
          Belum ada daftar entitas — dropdown &quot;pilih entitas&quot; di bawah masih kosong sampai diisi dulu. Buka{" "}
          <Link href="/finance/master-data" className="font-semibold underline">
            Master Data → Entitas
          </Link>{" "}
          untuk menambahkan (bisa manual atau import dari Google Sheets).
        </div>
      )}
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div>
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">No MRP (menunggu approval)</div>
          <select
            value={selectedMrpId}
            onChange={(e) => {
              setSelectedMrpId(e.target.value);
              setSelected(new Set());
            }}
            className="mt-1 rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
          >
            <option value="">— pilih MRP —</option>
            {selectable.map((d) => (
              <option key={d.mrp.id} value={d.mrp.id}>
                {d.mrp.id} · {formatPcs(d.mrp.qty)} pcs
              </option>
            ))}
          </select>
        </div>
        {withoutEntity > 0 && <StatusPill tone="warning">{withoutEntity} PO belum pilih entitas</StatusPill>}
        {selected.size > 0 && (
          <button onClick={approveSelected} className="ml-auto rounded-md bg-success px-3.5 py-[9px] font-sans text-xs font-semibold text-white">
            Approve {selected.size} terpilih
          </button>
        )}
      </div>

      {!detail && (
        <div className="rounded-lg border border-border-subtle bg-surface-card px-5 py-8 text-center font-sans text-xs text-text-muted">
          Tidak ada PO material menunggu approval saat ini.
        </div>
      )}

      {detail && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-[#EEF1F5]">
          {Array.from(grouped.entries()).map(([vendor, pos]) => {
            const selectablePos = pos.filter((p) => poHasAllEntitas(p));
            const allChecked = selectablePos.length > 0 && selectablePos.every((p) => selected.has(p.id));
            const vendorMaterialTotal = pos.reduce((a, p) => a + p.amount, 0);
            const vendorMaklonTotal = pos.reduce((a, p) => a + p.colorBreakdown.reduce((s, c) => s + maklonFeeForColorLine(p, c, maklonPOs, mrpDetails), 0), 0);
            const vendorRollTotal = pos.reduce((a, p) => a + p.rollCount, 0);

            return (
              <div key={vendor} className="border-b border-border-subtle last:border-b-0">
                <div className="flex items-center gap-2.5 bg-[#DEE4EC] px-5 py-[11px] font-sans text-[11px] font-semibold text-text-primary">
                  <Checkbox checked={allChecked} onChange={() => toggleVendorGroup(pos)} title="Centang/hapus centang seluruh material vendor ini (yang sudah punya entitas)" />
                  <span>→ {VENDOR_PRODUKSI[vendor]?.name ?? vendor}</span>
                </div>

                <div className="flex flex-col gap-2.5 px-3.5 py-3">
                  {pos.map((po) => {
                    const poMaklonTotal = po.colorBreakdown.reduce((a, c) => a + maklonFeeForColorLine(po, c, maklonPOs, mrpDetails), 0);
                    const hasEntity = poHasAllEntitas(po);
                    const bulkValue = poBulkEntitasValue(po);
                    return (
                      // Tiap PO jadi kartu putih tersendiri (border + shadow) di atas latar abu
                      // vendor-group — supaya jelas terlihat sebagai unit terpisah, tidak
                      // menyatu dengan PO di atas/bawahnya seperti sebelumnya.
                      <div key={po.id} className="overflow-hidden rounded-md border border-[#D8DEE6] bg-white shadow-[0_1px_3px_rgba(11,19,27,.06)]">
                        <div className="grid items-center gap-2 px-4 py-[11px]" style={{ gridTemplateColumns: "24px 110px 1fr 90px 120px 170px" }}>
                          <Checkbox checked={selected.has(po.id)} onChange={() => toggleWithEntityGuard(po)} />
                          <span className="font-mono font-medium text-xs text-[#31414F]">{po.id}</span>
                          <span className="font-sans text-xs text-[#31414F]">{po.supplier}</span>
                          <span className="text-right font-mono text-xs">{po.rollCount} roll</span>
                          <span className="text-right font-mono text-xs">{formatRupiah(po.amount)}</span>
                          <select
                            value={bulkValue}
                            onChange={(e) => chooseEntityBulk(po.id, e.target.value)}
                            title="Set entitas untuk SEMUA warna di PO ini sekaligus — warna yang perlu beda bisa di-override satu-satu di tabel di bawah"
                            className={
                              "rounded-md border-2 px-2 py-[5px] font-sans text-[11px] font-medium text-text-primary " +
                              (hasEntity ? "border-accent-blue" : "border-accent-blue/50")
                            }
                          >
                            <option value="">{po.colorBreakdown.some((c) => c.entitas) ? "— beda per warna —" : "— pilih entitas (semua warna) —"}</option>
                            {entitasList.map((e) => (
                              <option key={e.id} value={e.nama}>
                                {e.nama}
                              </option>
                            ))}
                          </select>
                        </div>
                        {entityHintPoId === po.id && (
                          <div className="mx-4 mb-2 flex items-center gap-1.5 rounded-md border border-[#F0DFC2] bg-warning-bg px-2.5 py-[6px] font-sans text-[11px] font-medium text-warning-fg">
                            ⚠ Semua warna di PO ini harus punya entitas dulu sebelum centang PO ini — isi lewat dropdown di atas (semua warna sekaligus) atau
                            per baris warna di bawah.
                          </div>
                        )}
                        <div className="mx-4 mb-3 overflow-hidden rounded-md border border-[#F1F4F7]">
                          <div className="grid grid-cols-5 gap-2 bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                            <span>Warna / lengan</span>
                            <span className="text-right">Roll</span>
                            <span className="text-right">Nilai material</span>
                            <span className="text-right">Biaya maklon</span>
                            <span>Entitas</span>
                          </div>
                          {po.colorBreakdown.map((c, i) => (
                            <div key={i} className="grid grid-cols-5 items-center gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                              <span>
                                {c.warna} · {c.lengan}
                              </span>
                              <span className="text-right font-mono">{c.rollCount}</span>
                              <span className="text-right font-mono">{formatRupiah((po.amount / po.rollCount) * c.rollCount)}</span>
                              <span className="text-right font-mono">{formatRupiah(maklonFeeForColorLine(po, c, maklonPOs, mrpDetails))}</span>
                              <select
                                value={c.entitas ?? ""}
                                onChange={(e) => chooseEntityForColor(po.id, c.warna, c.lengan, e.target.value)}
                                className={"rounded-md border px-1.5 py-1 font-sans text-[10.5px] font-medium text-text-primary " + (c.entitas ? "border-accent-blue/60" : "border-warning")}
                              >
                                <option value="">— pilih —</option>
                                {entitasList.map((e) => (
                                  <option key={e.id} value={e.nama}>
                                    {e.nama}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                          <div className="grid grid-cols-5 gap-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[11.5px] font-semibold text-info-fg">
                            <span>Subtotal PO {po.id}</span>
                            <span className="text-right font-mono">{po.rollCount} roll</span>
                            <span className="text-right font-mono">{formatRupiah(po.amount)}</span>
                            <span className="text-right font-mono">{formatRupiah(poMaklonTotal)}</span>
                            <span />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-4 bg-[#DEE4EC] px-5 py-[10px] font-sans text-[11px] font-semibold text-text-primary">
                  <span>Total vendor {VENDOR_PRODUKSI[vendor]?.name ?? vendor}:</span>
                  <span>Roll: {vendorRollTotal}</span>
                  <span>Material: {formatRupiah(vendorMaterialTotal)}</span>
                  <span>Maklon: {formatRupiah(vendorMaklonTotal)}</span>
                  <span>Total: {formatRupiah(vendorMaterialTotal + vendorMaklonTotal)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DataTable
        title="PO Material disetujui"
        columns={approvedColumns}
        rows={approved}
        keyOf={(p) => p.id}
        firstColumnLabel="No. MRP"
        firstColumnRender={(p) => <span className="font-mono">{p.mrpId}</span>}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(approved.map((p) => p.mrpId))), test: (p, v) => p.mrpId === v },
          { label: "No PO", options: Array.from(new Set(approved.map((p) => p.id))), test: (p, v) => p.id === v },
          {
            label: "Status",
            options: Array.from(
              new Set(approved.map((p) => materialPoFullStatusBadge(materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs)).label))
            ),
            test: (p, v) => materialPoFullStatusBadge(materialPoFullStatus(p, invoices, productionBatches, productionResults, mrpDetails, deliveryKolis, vendorInvoices, maklonPOs)).label === v,
          },
        ]}
        emptyText="Belum ada PO material disetujui."
      />
    </>
  );
}
