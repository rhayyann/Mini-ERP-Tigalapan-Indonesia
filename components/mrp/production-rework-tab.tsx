"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { cumulativeSizeQtyForGroup, cutWarnaLenganGroups, formatDateTimeShort, mrpDetailFor, mrpIdsWithRemainingReject, productionGroupMetaFor } from "@/lib/mrp/derive";
import type { Lengan, Usia } from "@/lib/mrp/types";

const USIA_OPTIONS: Usia[] = ["DEWASA", "KIDS"];

/** Rework fisik cuma bisa memotong lengan PANJANG jadi PENDEK (sisa potongan lengan) — lengan
 *  yang sudah PENDEK tidak bisa "dipanjangkan" lagi, jadi satu-satunya tujuan valid untuk reject
 *  PENDEK adalah tetap PENDEK (size lain), sedangkan reject PANJANG bisa jadi PANJANG atau
 *  PENDEK. Guard yang sama dicek lagi server-side di reworkRejectSizeAction. */
function reworkLenganOptionsFor(fromLengan: Lengan): Lengan[] {
  return fromLengan === "PANJANG" ? ["PANJANG", "PENDEK"] : ["PENDEK"];
}

export function ProductionReworkTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const reworkRejectSize = useMrpStore((s) => s.reworkRejectSize);
  const wasteRejectSize = useMrpStore((s) => s.wasteRejectSize);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [reworking, setReworking] = useState<{ warna: string; lengan: Lengan; size: string; max: number } | null>(null);
  const [qty, setQty] = useState(1);
  const [toLengan, setToLengan] = useState<Lengan>("PENDEK");
  const [toSize, setToSize] = useState("");
  const [usia, setUsia] = useState<Usia>("DEWASA");
  // Pesan error dari reworkRejectSize/wasteRejectSize -- dulu kalau grup sudah "Selesai Produksi"
  // action-nya diam-diam tidak melakukan apa-apa (tidak ada error, tidak ada perubahan), jadi
  // terlihat seperti tombol tidak berfungsi. Sekarang server melempar error yang ditangkap &
  // ditampilkan di sini (lihat juga filter `groups` di bawah — grup yang sudah selesai sekarang
  // tidak lagi ditampilkan di daftar sisa reject, supaya kasus ini jarang kejadian dari awal).
  const [actionError, setActionError] = useState<string | null>(null);

  // Buang ke sisa/waste — alur terpisah dari rework, tidak butuh lengan/size tujuan (hasilnya
  // bukan garmen, jadi tidak dilaporkan availableFgToShip/Pengiriman).
  const [wasting, setWasting] = useState<{ warna: string; lengan: Lengan; size: string; max: number } | null>(null);
  const [wasteQty, setWasteQty] = useState(1);
  const [wasteNote, setWasteNote] = useState("");

  const mrpIds = mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults);
  // Grup yang sudah "Selesai Produksi" dikunci (lihat markProductionGroupDoneAction) -- tidak
  // ditampilkan lagi sebagai baris "sisa reject" yang bisa di-rework/buang, supaya tidak
  // mengarahkan vendor ke aksi yang pasti akan ditolak server (buka kunci dulu di tab Final
  // Produksi kalau memang masih perlu rework).
  const allGroups = selectedMrpId ? cutWarnaLenganGroups(selectedMrpId, vendorId, productionBatches) : [];
  const groups = allGroups.filter((g) => !productionGroupMetaFor(selectedMrpId + "|" + g.warna + "|" + g.lengan, productionGroupMeta)?.doneAt);
  const lockedGroupCount = allGroups.length - groups.length;
  const selectedKategori = selectedMrpId ? (mrpDetailFor(selectedMrpId, mrpDetails)?.mrp.kategori ?? "—") : "";
  // Size yang dikenal untuk MRP ini (dari rencana aduan pola) -- dipakai sebagai pilihan dropdown
  // "Size baru (hasil rework)" supaya tidak salah ketik size yang tidak ada di rencana.
  const knownSizes = Array.from(new Set((mrpDetailFor(selectedMrpId, mrpDetails)?.aduanRows ?? []).flatMap((a) => a.sizes.map((s) => s.size)))).sort();

  function openRework(warna: string, lengan: Lengan, size: string, max: number) {
    setActionError(null);
    setWasting(null);
    setReworking({ warna, lengan, size, max });
    setQty(Math.min(1, max));
    setToLengan(reworkLenganOptionsFor(lengan)[0]);
    setToSize("");
    setUsia("DEWASA");
  }

  function openWaste(warna: string, lengan: Lengan, size: string, max: number) {
    setActionError(null);
    setReworking(null);
    setWasting({ warna, lengan, size, max });
    setWasteQty(Math.min(1, max));
    setWasteNote("");
  }

  async function submitRework() {
    if (!reworking || !toSize.trim() || qty <= 0) return;
    // Guard lagi di client (selain di server) — dropdown toLengan sudah dibatasi opsinya lewat
    // reworkLenganOptionsFor, tapi dicek ulang di sini kalau-kalau state-nya nyangkut.
    if (reworking.lengan === "PENDEK" && toLengan === "PANJANG") return;
    setActionError(null);
    try {
      await reworkRejectSize({
        mrpId: selectedMrpId,
        vendorProduksi: vendorId,
        warna: reworking.warna,
        lengan: reworking.lengan,
        fromSize: reworking.size,
        qty: Math.min(qty, reworking.max),
        toLengan,
        toSize: toSize.trim(),
        usia,
      });
      setReworking(null);
      setToSize("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal menyimpan rework.");
    }
  }

  async function submitWaste() {
    if (!wasting || wasteQty <= 0) return;
    setActionError(null);
    try {
      await wasteRejectSize({
        mrpId: selectedMrpId,
        vendorProduksi: vendorId,
        warna: wasting.warna,
        lengan: wasting.lengan,
        fromSize: wasting.size,
        qty: Math.min(wasteQty, wasting.max),
        note: wasteNote.trim() || undefined,
      });
      setWasting(null);
      setWasteNote("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal menyimpan buang ke sisa/waste.");
    }
  }

  const reworkHistory = productionResults.filter((r) => r.vendorProduksi === vendorId && r.kind === "FG" && (r.note ?? "").startsWith("Rework")).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));
  const wasteHistory = productionResults.filter((r) => r.vendorProduksi === vendorId && r.kind === "WASTE").sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => {
            setSelectedMrpId(e.target.value);
            setReworking(null);
            setWasting(null);
          }}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {mrpIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {mrpIds.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP dengan sisa reject yang belum di-rework.</div>}
        {selectedMrpId && (
          <div className="mt-2 font-sans text-[11.5px] text-text-muted">
            Kategori: <span className="font-semibold text-text-primary">{selectedKategori}</span>
          </div>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-[#EFC9C4] bg-danger-bg px-4 py-3 font-sans text-[11.5px] leading-[1.5] text-danger-fg">{actionError}</div>
      )}

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Sisa reject — {selectedMrpId}</div>
          {lockedGroupCount > 0 && (
            <div className="border-b border-border-subtle bg-[#F7F9FB] px-4 py-2 font-sans text-[11px] text-text-muted">
              {lockedGroupCount} warna/lengan sudah ditandai &quot;Selesai Produksi&quot; — tidak ditampilkan di sini lagi. Buka kunci dulu di tab Final Produksi kalau masih perlu rework.
            </div>
          )}
          <div className="grid grid-cols-6 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Kategori</span>
            <span>Warna / lengan</span>
            <span>Size</span>
            <span className="text-right">Sisa reject</span>
            <span />
            <span />
          </div>
          {groups.flatMap((g) => {
            const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
            const remaining = cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults);
            return Object.entries(remaining)
              .filter(([, qty]) => qty > 0)
              .map(([size, remainingQty]) => (
                <div key={groupKey + size} className="grid grid-cols-6 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]">
                  <span>{selectedKategori}</span>
                  <span>
                    {g.warna} · {g.lengan}
                  </span>
                  <span className="font-mono font-medium">{size}</span>
                  <span className="text-right font-mono text-danger-fg">{remainingQty}</span>
                  <span className="text-right">
                    <Button onClick={() => openRework(g.warna, g.lengan, size, remainingQty)} variant="primary" size="xs">
                      Rework jadi baju →
                    </Button>
                  </span>
                  <span className="text-right">
                    <Button onClick={() => openWaste(g.warna, g.lengan, size, remainingQty)} variant="danger" size="xs">
                      Buang ke sisa →
                    </Button>
                  </span>
                </div>
              ));
          })}
          {groups.every((g) => Object.values(cumulativeSizeQtyForGroup(selectedMrpId + "|" + g.warna + "|" + g.lengan, "REJECT", productionResults)).every((v) => v <= 0)) && (
            <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada sisa reject untuk MRP ini.</div>
          )}

          {reworking && (
            <div className="border-t border-[#CFE0EF] bg-info-bg p-4">
              <div className="font-sans text-xs font-semibold text-info-fg">
                Rework {reworking.warna} · {reworking.lengan} — size {reworking.size} (maks {reworking.max} pcs)
              </div>
              {reworking.lengan === "PENDEK" && (
                <div className="mt-1.5 font-sans text-[10.5px] text-warning-fg">
                  Reject lengan PENDEK cuma bisa dirework jadi size lain — lengan tidak bisa dipanjangkan.
                </div>
              )}
              <div className="mt-2 grid grid-cols-4 gap-3">
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Qty dirework</div>
                  <NumberInput value={qty} onChange={(v) => setQty(Math.max(1, Math.min(v, reworking.max)))} decimals={0} className="input mt-1" />
                </div>
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Lengan hasil rework</div>
                  <select value={toLengan} onChange={(e) => setToLengan(e.target.value as Lengan)} className="input mt-1">
                    {reworkLenganOptionsFor(reworking.lengan).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Size baru (hasil rework)</div>
                  {/* Dulu free-text (rawan salah ketik) -- sekarang dropdown dari size yang
                      benar-benar ada di rencana aduan pola MRP ini. */}
                  <select value={toSize} onChange={(e) => setToSize(e.target.value)} className="input mt-1">
                    <option value="">— pilih size —</option>
                    {knownSizes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {knownSizes.length === 0 && <div className="mt-1 font-sans text-[10px] text-danger-fg">Tidak ada size terdaftar untuk MRP ini.</div>}
                </div>
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Kids atau Dewasa</div>
                  <select value={usia} onChange={(e) => setUsia(e.target.value as Usia)} className="input mt-1">
                    {USIA_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={submitRework}
                  disabled={!toSize.trim()}
                  className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Simpan Rework
                </button>
                <button onClick={() => setReworking(null)} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-action-primary">
                  Batal
                </button>
              </div>
            </div>
          )}

          {wasting && (
            <div className="border-t border-[#F0DFC2] bg-warning-bg p-4">
              <div className="font-sans text-xs font-semibold text-warning-fg">
                Buang ke sisa/waste — {wasting.warna} · {wasting.lengan} — size {wasting.size} (maks {wasting.max} pcs)
              </div>
              <div className="mt-1.5 font-sans text-[10.5px] text-warning-fg">
                Jadi sisa kain/majun — TIDAK jadi garmen, tidak muncul lagi di manapun (Finish Good, Pengiriman).
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Qty dibuang</div>
                  <NumberInput value={wasteQty} onChange={(v) => setWasteQty(Math.max(1, Math.min(v, wasting.max)))} decimals={0} className="input mt-1" />
                </div>
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Catatan (opsional)</div>
                  <input value={wasteNote} onChange={(e) => setWasteNote(e.target.value)} placeholder="Contoh: sisa potong lengan tidak cukup" className="input mt-1" />
                </div>
              </div>
              <div className="mt-2.5 flex gap-2">
                <button onClick={submitWaste} className="rounded-md bg-danger px-3.5 py-2 font-sans text-xs font-semibold text-white">
                  Simpan
                </button>
                <button onClick={() => setWasting(null)} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-action-primary">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat rework</div>
        <div className="grid grid-cols-7 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          <span>MRP</span>
          <span>Kategori</span>
          <span>Warna / lengan</span>
          <span>Usia</span>
          <span className="text-right">Qty</span>
          <span>Catatan</span>
          <span>Tanggal</span>
        </div>
        {reworkHistory.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada rework.</div>}
        {reworkHistory.map((r) => (
          <div key={r.id} className="grid grid-cols-7 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
            <span className="font-mono">{r.mrpId}</span>
            <span>{mrpDetailFor(r.mrpId, mrpDetails)?.mrp.kategori ?? "—"}</span>
            <span>
              {r.warna} · {r.lengan}
            </span>
            <span>{r.usia ?? "—"}</span>
            <span className="text-right font-mono font-medium">{Object.values(r.sizeQty).reduce((a, b) => a + b, 0)}</span>
            <span>{r.note}</span>
            <span className="font-mono text-[11px] text-text-muted">{formatDateTimeShort(r.recordedAt)}</span>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat buang ke sisa/waste</div>
        <div className="grid grid-cols-6 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          <span>MRP</span>
          <span>Kategori</span>
          <span>Warna / lengan</span>
          <span className="text-right">Qty</span>
          <span>Catatan</span>
          <span>Tanggal</span>
        </div>
        {wasteHistory.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada yang dibuang ke sisa/waste.</div>}
        {wasteHistory.map((r) => (
          <div key={r.id} className="grid grid-cols-6 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
            <span className="font-mono">{r.mrpId}</span>
            <span>{mrpDetailFor(r.mrpId, mrpDetails)?.mrp.kategori ?? "—"}</span>
            <span>
              {r.warna} · {r.lengan}
            </span>
            <span className="text-right font-mono font-medium">{Object.values(r.sizeQty).reduce((a, b) => a + b, 0)}</span>
            <span>{r.note}</span>
            <span className="font-mono text-[11px] text-text-muted">{formatDateTimeShort(r.recordedAt)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
