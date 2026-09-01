"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { useMrpStore } from "@/lib/mrp/store";
import { availableCodeRollsForColor, availableRollsForAduanRow, formatDateTime, formatDuration, materialReceivedForMaklon, restingMinutes } from "@/lib/mrp/derive";
import { RESTING_TARGET_MINUTES } from "@/lib/mrp/seed";
import type { AduanPolaRow, Lengan } from "@/lib/mrp/types";

function nowLocalDatetime() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type AduanGroup = { kode: string; lengan: Lengan; rows: (AduanPolaRow & { available: number })[]; totalQty: number; totalAvailable: number };
type CuttingLine = { id: string; warna: string; codeRoll: string; gramasi: number };

export function ProductionCuttingTab({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const invoices = useMrpStore((s) => s.invoices);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const startProductionBatch = useMrpStore((s) => s.startProductionBatch);
  const updateBatchToCutting = useMrpStore((s) => s.updateBatchToCutting);

  const [selectedMrpId, setSelectedMrpId] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [lines, setLines] = useState<CuttingLine[]>([]);
  const [restingAt, setRestingAt] = useState(nowLocalDatetime());
  const [cuttingDraft, setCuttingDraft] = useState<Record<string, string>>({});
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);

  const activeStages: string[] = ["PARTIAL_WAITING_MATERIAL", "FULL_WAITING_MATERIAL", "PRODUCTION", "PARTIAL_PRODUCTION"];
  const readyMrpIds = maklonPOs
    .filter((p) => p.vendorProduksi === vendorId && p.approved && activeStages.includes(p.status) && materialReceivedForMaklon(p.mrpId, vendorId, invoices))
    .map((p) => p.mrpId);
  const readyMrps = mrpDetails.filter((d) => readyMrpIds.includes(d.mrp.id));

  const selectedDetail = mrpDetails.find((d) => d.mrp.id === selectedMrpId);
  const aduanRows = (selectedDetail?.aduanRows ?? []).filter((a) => a.vendor === vendorId);

  const groups = new Map<string, AduanGroup>();
  for (const row of aduanRows) {
    const available = selectedDetail ? availableRollsForAduanRow(row, selectedDetail.aduanRows, invoices, productionBatches, selectedMrpId) : 0;
    const key = row.kode + "|" + row.lengan;
    const g = groups.get(key) ?? { kode: row.kode, lengan: row.lengan, rows: [], totalQty: 0, totalAvailable: 0 };
    g.rows.push({ ...row, available });
    g.totalQty += row.qtyRoll;
    g.totalAvailable += available;
    groups.set(key, g);
  }
  const groupList = Array.from(groups.values());
  const selectedGroup = groups.get(selectedGroupKey) ?? null;

  function pickMrp(mrpId: string) {
    setSelectedMrpId(mrpId);
    setSelectedGroupKey("");
    setLines([]);
    setSubmitNotice(null);
  }

  function pickGroup(key: string) {
    setSelectedGroupKey(key);
    const g = groups.get(key);
    setRestingAt(nowLocalDatetime());
    setLines([{ id: "line-" + Date.now(), warna: g?.rows[0]?.warna ?? "", codeRoll: "", gramasi: 0 }]);
    setSubmitNotice(null);
  }

  function addLine() {
    // Tiap baris = 1 roll (qtyRoll di-hardcode 1 saat submit) — jangan biarkan user menambah
    // baris melebihi jumlah roll yang benar-benar tersedia untuk aduan pola ini, supaya tidak
    // ada baris "hantu" tanpa code roll yang bisa dipilih (dropdown-nya pasti kosong).
    if (selectedGroup && lines.length >= selectedGroup.totalAvailable) return;
    setLines((prev) => [...prev, { id: "line-" + Date.now() + "-" + prev.length, warna: selectedGroup?.rows[0]?.warna ?? "", codeRoll: "", gramasi: 0 }]);
  }

  function updateLine(id: string, patch: Partial<CuttingLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function codeOptionsFor(warna: string, excludeLineId: string): string[] {
    if (!selectedGroup) return [];
    const all = availableCodeRollsForColor(selectedMrpId, warna, selectedGroup.lengan, vendorId, invoices, productionBatches);
    const pickedElsewhere = new Set(lines.filter((l) => l.id !== excludeLineId).map((l) => l.codeRoll).filter(Boolean));
    return all.filter((c) => !pickedElsewhere.has(c));
  }

  function submitResting() {
    if (!selectedGroup) return;
    // Dulu baris yang belum lengkap (mis. belum pilih code roll) di-skip DIAM-DIAM lalu semua
    // baris (termasuk yang di-skip) langsung dihapus dari layar — user tidak sadar sebagian
    // rollnya gagal tersimpan, cuma tahu belakangan dari "Total Roll Tersedia" yang ternyata
    // masih sisa. Sekarang: baris yang berhasil disimpan dihapus, baris yang belum lengkap
    // TETAP tampil supaya user bisa lengkapi & submit ulang.
    const remaining: CuttingLine[] = [];
    let savedCount = 0;
    for (const line of lines) {
      if (!line.warna || !line.codeRoll) {
        remaining.push(line);
        continue;
      }
      const row = selectedGroup.rows.find((r) => r.warna === line.warna);
      if (!row) {
        remaining.push(line);
        continue;
      }
      startProductionBatch({ mrpId: selectedMrpId, aduanRowId: row.id, qtyRoll: 1, gramasi: line.gramasi, restingAt, codeRoll: line.codeRoll });
      savedCount++;
    }
    setSubmitNotice(
      remaining.length > 0
        ? `${savedCount} roll berhasil di-resting. ${remaining.length} baris belum lengkap (pilih code roll dulu) — belum tersimpan.`
        : null
    );
    setLines(remaining);
    if (remaining.length === 0) setSelectedGroupKey("");
  }

  const myBatches = productionBatches.filter((b) => b.vendorProduksi === vendorId);
  const canSubmit = lines.some((l) => l.warna && l.codeRoll);

  return (
    <>
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Mulai Produksi — pilih MRP</div>
        <select
          value={selectedMrpId}
          onChange={(e) => pickMrp(e.target.value)}
          className="mt-1 w-full max-w-[420px] rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] font-medium text-text-primary"
        >
          <option value="">— pilih MRP —</option>
          {readyMrps.map((d) => (
            <option key={d.mrp.id} value={d.mrp.id}>
              {d.mrp.id}
            </option>
          ))}
        </select>
        {readyMrps.length === 0 && <div className="mt-2 font-sans text-xs text-text-muted">Belum ada MRP dengan bahan siap dan pekerjaan belum selesai.</div>}
      </div>

      {selectedDetail && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Aduan pola — {selectedDetail.mrp.id}</div>
          <div className="grid grid-cols-4 gap-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
            <span>Kode aduan / lengan</span>
            <span className="text-right">Total qty roll aduan</span>
            <span className="text-right">Total roll tersedia</span>
            <span />
          </div>
          {groupList.map((g) => {
            const key = g.kode + "|" + g.lengan;
            return (
              <div key={key} className="grid grid-cols-4 items-center gap-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono font-medium">
                  {g.kode} · {g.lengan}
                </span>
                <span className="text-right font-mono">{g.totalQty}</span>
                <span className={"text-right font-mono " + (g.totalAvailable > 0 ? "text-success-fg" : "text-text-muted")}>{g.totalAvailable}</span>
                <span className="text-right">
                  <button
                    onClick={() => pickGroup(key)}
                    disabled={g.totalAvailable <= 0}
                    className="font-sans text-[11px] font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Pilih
                  </button>
                </span>
              </div>
            );
          })}

          {selectedGroup && (
            <div className="border-t border-[#CFE0EF] bg-info-bg p-4">
              <div className="font-sans text-xs font-semibold text-info-fg">
                {selectedGroup.kode} · {selectedGroup.lengan} — pilih warna, code roll &amp; gramasi
              </div>

              <div className="mt-2.5 flex items-end gap-3">
                <div>
                  <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Tanggal &amp; jam resting</div>
                  <input type="datetime-local" value={restingAt} onChange={(e) => setRestingAt(e.target.value)} className="input mt-1" />
                </div>
                <button
                  onClick={addLine}
                  disabled={lines.length >= selectedGroup.totalAvailable}
                  title={lines.length >= selectedGroup.totalAvailable ? "Semua roll tersedia sudah ditambahkan" : undefined}
                  className="rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[8px] font-sans text-[11px] font-semibold text-text-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add roll
                </button>
                <span className="font-sans text-[11px] text-text-muted">
                  {lines.length} / {selectedGroup.totalAvailable} roll tersedia
                </span>
              </div>

              <div className="mt-2.5 overflow-hidden rounded-md border border-[#CFE0EF] bg-white">
                <div className="grid grid-cols-4 gap-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna</span>
                  <span>Code roll</span>
                  <span className="text-right">Gramasi (gsm)</span>
                  <span className="text-right">Aksi</span>
                </div>
                {lines.map((line) => {
                  const codeOptions = codeOptionsFor(line.warna, line.id);
                  // Roll ini dihitung "tersedia" (qty-wise) tapi tidak ada code roll yang bisa
                  // dipilih — biasanya karena roll fisiknya diterima di Good Receive tanpa code
                  // roll diisi. Baris ini TIDAK BISA disubmit sampai code roll-nya dilengkapi
                  // (lihat submitResting) — beri tahu user secara eksplisit, jangan biarkan diam.
                  const noCodeAvailable = codeOptions.length === 0 && !line.codeRoll;
                  return (
                    <div key={line.id} className="border-t border-[#F1F4F7]">
                      <div className="grid grid-cols-4 items-center gap-2 px-3 py-1.5 font-sans text-xs text-[#31414F]">
                        <select
                          value={line.warna}
                          onChange={(e) => updateLine(line.id, { warna: e.target.value, codeRoll: "" })}
                          className="rounded-md border border-[#DDE4EB] px-1.5 py-1 font-sans text-[11.5px]"
                        >
                          {selectedGroup.rows.map((r) => (
                            <option key={r.warna} value={r.warna}>
                              {r.warna}
                            </option>
                          ))}
                        </select>
                        <select
                          value={line.codeRoll}
                          onChange={(e) => updateLine(line.id, { codeRoll: e.target.value })}
                          className={"rounded-md border px-1.5 py-1 font-sans text-[11.5px] " + (noCodeAvailable ? "border-danger" : "border-[#DDE4EB]")}
                        >
                          <option value="">— pilih code roll —</option>
                          {codeOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <span className="flex justify-end">
                          <NumberInput value={line.gramasi} onChange={(v) => updateLine(line.id, { gramasi: v })} decimals={0} className="input w-[90px] text-right" />
                        </span>
                        <span className="text-right">
                          <Button onClick={() => removeLine(line.id)} variant="danger" size="xs">
                            Hapus
                          </Button>
                        </span>
                      </div>
                      {noCodeAvailable && (
                        <div className="px-3 pb-1.5 font-sans text-[10.5px] text-danger-fg">
                          Belum ada code roll yang bisa dipilih untuk warna ini — kemungkinan roll diterima tanpa code roll di Good Receive, atau roll-nya masih berstatus klaim
                          selisih berat (di luar toleransi / retur diminta, belum ditimbang ulang sesuai) — cek halaman Klaim Material.
                        </div>
                      )}
                    </div>
                  );
                })}
                {lines.length === 0 && <div className="px-3 py-3 text-center font-sans text-[11px] text-text-muted">Belum ada baris — klik + Add roll.</div>}
              </div>
              {submitNotice && (
                <div className="mt-2.5 rounded-md border border-[#F0DFC2] bg-warning-bg px-3 py-2 font-sans text-[11px] leading-[1.5] text-warning-fg">{submitNotice}</div>
              )}

              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={submitResting}
                  disabled={!canSubmit}
                  className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Resting
                </button>
                <button onClick={() => setSelectedGroupKey("")} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-action-primary">
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Material dalam produksi</div>
        <div className="overflow-x-auto">
          <div>
            <div
              className="grid min-w-[1040px] gap-x-3 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{
                gridTemplateColumns:
                  "minmax(80px,0.6fr) minmax(70px,0.5fr) minmax(140px,1.1fr) minmax(120px,0.9fr) minmax(60px,0.5fr) minmax(90px,0.7fr) minmax(140px,1.1fr) minmax(170px,1.3fr) minmax(170px,1.3fr)",
              }}
            >
              <span>MRP</span>
              <span>Kode</span>
              <span>Warna / lengan</span>
              <span>Code roll</span>
              <span className="text-right">Roll</span>
              <span className="text-right">Gramasi</span>
              <span>Resting</span>
              <span>Cutting</span>
              <span>Durasi Resting</span>
            </div>
            {myBatches.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada batch produksi.</div>}
            {myBatches.map((b) => {
              const draft = cuttingDraft[b.id];
              const durasiKurang = b.cuttingAt ? restingMinutes(b.restingAt, b.cuttingAt) < RESTING_TARGET_MINUTES : false;
              return (
                <div
                  key={b.id}
                  className="grid min-w-[1040px] items-center gap-x-3 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                  style={{
                    gridTemplateColumns:
                      "minmax(80px,0.6fr) minmax(70px,0.5fr) minmax(140px,1.1fr) minmax(120px,0.9fr) minmax(60px,0.5fr) minmax(90px,0.7fr) minmax(140px,1.1fr) minmax(170px,1.3fr) minmax(170px,1.3fr)",
                  }}
                >
                  <span className="font-mono">{b.mrpId}</span>
                  <span className="font-mono font-medium">{b.kode}</span>
                  <span>
                    {b.warna} · {b.lengan}
                  </span>
                  <span className="font-mono text-[11px]">{b.codeRoll || "—"}</span>
                  <span className="text-right font-mono">{b.qtyRoll}</span>
                  <span className="text-right font-mono">{b.gramasi} gsm</span>
                  <span className="font-mono text-[11px]">{formatDateTime(b.restingAt)}</span>
                  <span className="font-mono text-[11px]">
                    {b.cuttingAt ? (
                      formatDateTime(b.cuttingAt)
                    ) : draft !== undefined ? (
                      <span className="flex flex-col items-start gap-1">
                        <input
                          type="datetime-local"
                          value={draft}
                          onChange={(e) => setCuttingDraft((prev) => ({ ...prev, [b.id]: e.target.value }))}
                          className="w-full rounded-md border border-[#DDE4EB] px-1.5 py-1 font-mono text-[11px]"
                        />
                        <Button
                          onClick={() => {
                            updateBatchToCutting(b.id, draft);
                            setCuttingDraft((prev) => {
                              const next = { ...prev };
                              delete next[b.id];
                              return next;
                            });
                          }}
                          variant="success"
                          size="xs"
                        >
                          Simpan
                        </Button>
                      </span>
                    ) : (
                      <Button
                        onClick={() => setCuttingDraft((prev) => ({ ...prev, [b.id]: nowLocalDatetime() }))}
                        variant="primary"
                        size="xs"
                      >
                        Update ke Cutting →
                      </Button>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
                    {formatDuration(b.restingAt, b.cuttingAt ?? new Date().toISOString())}
                    {durasiKurang && <StatusPill tone="warning">RESTING KURANG DARI TARGET</StatusPill>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
