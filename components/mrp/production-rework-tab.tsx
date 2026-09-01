"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { cumulativeSizeQtyForGroup, cutWarnaLenganGroups, mrpDetailFor, mrpIdsWithRemainingReject } from "@/lib/mrp/derive";
import type { Lengan, Usia } from "@/lib/mrp/types";

const LENGAN_OPTIONS: Lengan[] = ["PENDEK", "PANJANG"];
const USIA_OPTIONS: Usia[] = ["DEWASA", "KIDS"];

export function ProductionReworkTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const productionResults = useMrpStore((s) => s.productionResults);
  const reworkRejectSize = useMrpStore((s) => s.reworkRejectSize);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [reworking, setReworking] = useState<{ warna: string; lengan: Lengan; size: string; max: number } | null>(null);
  const [qty, setQty] = useState(1);
  const [toLengan, setToLengan] = useState<Lengan>("PENDEK");
  const [toSize, setToSize] = useState("");
  const [usia, setUsia] = useState<Usia>("DEWASA");

  const mrpIds = mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults);
  const groups = selectedMrpId ? cutWarnaLenganGroups(selectedMrpId, vendorId, productionBatches) : [];
  const selectedKategori = selectedMrpId ? (mrpDetailFor(selectedMrpId, mrpDetails)?.mrp.kategori ?? "—") : "";

  function openRework(warna: string, lengan: Lengan, size: string, max: number) {
    setReworking({ warna, lengan, size, max });
    setQty(Math.min(1, max));
    setToLengan(lengan);
    setToSize("");
    setUsia("DEWASA");
  }

  function submitRework() {
    if (!reworking || !toSize.trim() || qty <= 0) return;
    reworkRejectSize({
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
  }

  const reworkHistory = productionResults.filter((r) => r.vendorProduksi === vendorId && (r.note ?? "").startsWith("Rework")).sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => {
            setSelectedMrpId(e.target.value);
            setReworking(null);
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

      {selectedMrpId && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Sisa reject — {selectedMrpId}</div>
          <div className="grid grid-cols-5 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Kategori</span>
            <span>Warna / lengan</span>
            <span>Size</span>
            <span className="text-right">Sisa reject</span>
            <span />
          </div>
          {groups.flatMap((g) => {
            const groupKey = selectedMrpId + "|" + g.warna + "|" + g.lengan;
            const remaining = cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults);
            return Object.entries(remaining)
              .filter(([, qty]) => qty > 0)
              .map(([size, remainingQty]) => (
                <div key={groupKey + size} className="grid grid-cols-5 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F]">
                  <span>{selectedKategori}</span>
                  <span>
                    {g.warna} · {g.lengan}
                  </span>
                  <span className="font-mono font-medium">{size}</span>
                  <span className="text-right font-mono text-danger-fg">{remainingQty}</span>
                  <span className="text-right">
                    <Button onClick={() => openRework(g.warna, g.lengan, size, remainingQty)} variant="primary" size="xs">
                      Rework →
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
              <div className="mt-2 grid grid-cols-4 gap-3">
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Qty dirework</div>
                  <NumberInput value={qty} onChange={(v) => setQty(Math.max(1, Math.min(v, reworking.max)))} decimals={0} className="input mt-1" />
                </div>
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Lengan hasil rework</div>
                  <select value={toLengan} onChange={(e) => setToLengan(e.target.value as Lengan)} className="input mt-1">
                    {LENGAN_OPTIONS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Size baru (hasil rework)</div>
                  <input value={toSize} onChange={(e) => setToSize(e.target.value)} placeholder="Contoh: S" className="input mt-1" />
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
        {reworkHistory
          .filter((r) => r.kind === "FG")
          .map((r) => (
            <div key={r.id} className="grid grid-cols-7 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
              <span className="font-mono">{r.mrpId}</span>
              <span>{mrpDetailFor(r.mrpId, mrpDetails)?.mrp.kategori ?? "—"}</span>
              <span>
                {r.warna} · {r.lengan}
              </span>
              <span>{r.usia ?? "—"}</span>
              <span className="text-right font-mono font-medium">{Object.values(r.sizeQty).reduce((a, b) => a + b, 0)}</span>
              <span>{r.note}</span>
              <span className="font-mono text-[11px] text-text-muted">{r.recordedAt}</span>
            </div>
          ))}
      </div>
    </>
  );
}
