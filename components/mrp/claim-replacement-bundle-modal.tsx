"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { claimReplacementValue, formatRupiah, hargaKainRate } from "@/lib/mrp/derive";
import { readPdfAsDataUrl } from "@/lib/mrp/clientFiles";
import type { HargaKainPksRow, HargaKainRow } from "@/lib/mrp/masterData";
import type { MaterialClaimRow } from "@/lib/mrp/derive";

/** Versi GABUNGAN (2026-09-14, fitur "PV Pengganti gabungan") dari ClaimReplacementModal --
 *  PARALEL, bukan pengganti: modal single TIDAK disentuh sama sekali. Pola visual & struktur
 *  sengaja disamakan (lihat claim-replacement-modal.tsx) supaya konsisten, bedanya di sini
 *  menerima ARRAY klaim (semua sudah dipastikan 1 invoiceId sama oleh caller, lihat gating
 *  checkbox di material-claims/page.tsx -- server tetap validasi ulang, lihat
 *  createClaimReplacementInvoiceBundleAction).
 *
 *  Rate (Rp/kg) PER WARNA (bukan per roll, bukan 1 untuk semua) -- keputusan eksplisit user:
 *  "beda warna bisa beda harga bahan meskipun untuk satu vendor supplier". Berat (kg) TETAP per
 *  ROLL individual (fisik, tidak bisa digabung) -- dikelompokkan visual di bawah warna masing2. */
export function ClaimReplacementBundleModal({
  claims,
  rateLamaByKey,
  hargaKain,
  hargaKainPks,
  onCancel,
  onSubmit,
}: {
  claims: MaterialClaimRow[];
  /** Rate (Rp/kg) yang berlaku di PV LAMA, PER ROLL (bisa beda antar roll walau warna sama kalau
   *  rollnya berasal dari invoice_color berbeda -- di sini semua dari 1 invoice yang sama jadi
   *  secara praktis akan sama per warna/lengan, tapi tetap diambil per roll biar konsisten dengan
   *  cara modal single mengambilnya, lihat rateLamaFor() di material-claims/page.tsx). Key = claim
   *  key (sama seperti `claims[i].key`). Dipakai murni untuk preview -- server menghitung ulang
   *  sendiri dari DB. */
  rateLamaByKey: Record<string, number>;
  hargaKain: HargaKainRow[];
  hargaKainPks: HargaKainPksRow[];
  onCancel: () => void;
  onSubmit: (ratesByWarnaLengan: Record<string, number>, beratByKey: Record<string, number>, buktiInvoiceDataUrl?: string, buktiInvoiceFileName?: string) => Promise<void>;
}) {
  const invoiceId = claims[0]?.invoiceId ?? "";

  // Kelompokkan claims per warna|lengan -- urutan grup mengikuti kemunculan pertama di `claims`.
  const groupOrder: string[] = [];
  const groups = new Map<string, MaterialClaimRow[]>();
  for (const c of claims) {
    const groupKey = `${c.warna}|${c.lengan}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
      groupOrder.push(groupKey);
    }
    groups.get(groupKey)!.push(c);
  }

  const [rates, setRates] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const groupKey of groupOrder) {
      const items = groups.get(groupKey)!;
      const totalKg = items.reduce((sum, c) => sum + c.grossKg, 0);
      const first = items[0];
      const defaultRate = hargaKainRate(hargaKain, hargaKainPks, first.supplier, first.warna, totalKg);
      initial[groupKey] = defaultRate || rateLamaByKey[first.key] || 0;
    }
    return initial;
  });
  const [berat, setBerat] = useState<Record<string, number>>({});
  const [buktiDataUrl, setBuktiDataUrl] = useState<string | undefined>(undefined);
  const [buktiFileName, setBuktiFileName] = useState<string | undefined>(undefined);
  const [buktiError, setBuktiError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function setRate(groupKey: string, value: number) {
    setRates((prev) => ({ ...prev, [groupKey]: value }));
  }
  function setBeratForKey(key: string, value: number) {
    setBerat((prev) => ({ ...prev, [key]: value }));
  }

  const allRatesFilled = groupOrder.every((g) => rates[g] > 0);
  const allBeratFilled = claims.every((c) => (berat[c.key] ?? 0) > 0);
  const canSubmit = allRatesFilled && allBeratFilled && !submitting;

  let totalKredit = 0;
  let totalNilaiBaru = 0;
  for (const c of claims) {
    const preview = claimReplacementValue(rates[`${c.warna}|${c.lengan}`] ?? 0, berat[c.key] ?? 0, rateLamaByKey[c.key] ?? 0, c.grossKg);
    totalKredit += preview.kredit;
    totalNilaiBaru += preview.nilaiBaru;
  }
  const totalSelisih = totalNilaiBaru - totalKredit;

  async function handleFile(file: File | null) {
    setBuktiError("");
    if (!file) {
      setBuktiDataUrl(undefined);
      setBuktiFileName(undefined);
      return;
    }
    const result = await readPdfAsDataUrl(file);
    if ("error" in result) {
      setBuktiError(result.error);
      return;
    }
    setBuktiDataUrl(result.dataUrl);
    setBuktiFileName(result.fileName);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const beratByKey: Record<string, number> = {};
      for (const c of claims) beratByKey[c.key] = berat[c.key] ?? 0;
      await onSubmit(rates, beratByKey, buktiDataUrl, buktiFileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[560px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">
            Buat PV Pengganti Gabungan — {claims.length} roll dari {invoiceId}
          </span>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="font-sans text-[11px] text-text-muted">
            Supplier: <span className="font-medium text-text-primary">{claims[0]?.supplier}</span> · PV baru: otomatis
          </div>

          {groupOrder.map((groupKey) => {
            const items = groups.get(groupKey)!;
            const [warna, lengan] = groupKey.split("|");
            return (
              <div key={groupKey} className="mt-3 overflow-hidden rounded-md border border-[#E4E8EE]">
                <div className="flex items-center justify-between bg-[#F7F9FB] px-3 py-2">
                  <span className="font-sans text-[11.5px] font-semibold text-text-primary">
                    {warna} · {lengan}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Rate baru (Rp/kg)</span>
                    <NumberInput value={rates[groupKey] ?? 0} onChange={(v) => setRate(groupKey, v)} currency placeholder="Rp 113.000" className="input w-[130px]" />
                  </div>
                </div>
                <div className="divide-y divide-[#F1F4F7]">
                  {items.map((c) => (
                    <div key={c.key} className="flex items-center justify-between px-3 py-2">
                      <span className="font-sans text-[11px] text-[#31414F]">
                        Roll #{c.rollIndex + 1}
                        {c.codeRoll ? ` · ${c.codeRoll}` : ""} — rate lama {formatRupiah(rateLamaByKey[c.key] ?? 0)}/kg · berat lama {c.grossKg.toFixed(2)} kg
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Berat (kg)</span>
                        <NumberInput
                          value={berat[c.key] ?? 0}
                          onChange={(v) => setBeratForKey(c.key, v)}
                          decimals={2}
                          commaOnly
                          startEmptyIfZero
                          placeholder="25,07"
                          className="input w-[100px]"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <label className="mt-3 block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Bukti Invoice (PDF) — 1 untuk seluruh PV gabungan</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-[11px] file:mr-1.5 file:rounded file:border-0 file:bg-info-bg file:px-2 file:py-1 file:font-sans file:text-[10.5px] file:font-semibold file:text-info-fg"
          />
          {buktiFileName && !buktiError && <div className="mt-1 font-sans text-[10.5px] font-medium text-success-fg">✓ {buktiFileName} terupload.</div>}
          {buktiError && <div className="mt-1 font-sans text-[10.5px] font-medium text-danger-fg">{buktiError}</div>}

          <div className="mt-3 overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span>Total nilai PV lama (kredit)</span>
              <span className="font-mono">{formatRupiah(totalKredit)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span>Total nilai PV baru</span>
              <span className="font-mono">{formatRupiah(totalNilaiBaru)}</span>
            </div>
            <div className={"flex items-center justify-between px-3 py-2 font-sans text-[11.5px] font-semibold " + (totalSelisih >= 0 ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg")}>
              <span>Selisih gabungan</span>
              <span className="font-mono">
                {totalSelisih >= 0 ? "+" : "−"}
                {formatRupiah(Math.abs(totalSelisih))}
              </span>
            </div>
          </div>
          {error && <div className="mt-2 font-sans text-[11.5px] font-medium text-danger-fg">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
          <button onClick={onCancel} disabled={submitting} className="rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary disabled:opacity-50">
            Batal
          </button>
          <button onClick={submit} disabled={!canSubmit} className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:opacity-50">
            {submitting ? "Menyimpan…" : "Buat PV Pengganti Gabungan"}
          </button>
        </div>
      </div>
    </div>
  );
}
