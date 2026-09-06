"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { claimReplacementValue, formatRupiah, hargaKainRate } from "@/lib/mrp/derive";
import { readPdfAsDataUrl } from "@/lib/mrp/clientFiles";
import type { HargaKainPksRow, HargaKainRow } from "@/lib/mrp/masterData";
import type { MaterialClaimRow } from "@/lib/mrp/derive";

/** Revisi 2026-09-06 (v2 -- disederhanakan atas permintaan owner, versi pertama kebanyakan teks
 *  instruksi & field opsional yang tidak kepakai): modal "Buat PV Pengganti". Langsung ke inti:
 *  rate, berat, bukti invoice, lalu perbandingan nilai lama vs baru. Rate & berat SENGAJA tidak
 *  dikunci ke PV lama (ikut harga terkini) -- preview selisih di bawah cuma ilustrasi, saldo
 *  deposit yang benar-benar tercatat baru dipakai manual belakangan oleh Finance (lihat
 *  payment-panel.tsx), bisa untuk invoice mana pun ke supplier ini, tidak terikat ke PV ini saja. */
export function ClaimReplacementModal({
  claim,
  rateLama,
  hargaKain,
  hargaKainPks,
  onCancel,
  onSubmit,
}: {
  claim: MaterialClaimRow;
  /** Rate (Rp/kg) yang berlaku di PV LAMA untuk warna/lengan ini -- dipakai murni untuk preview
   *  "kredit" (bukan dikirim ke server, server menghitung ulang sendiri dari DB). */
  rateLama: number;
  hargaKain: HargaKainRow[];
  hargaKainPks: HargaKainPksRow[];
  onCancel: () => void;
  onSubmit: (rateBaru: number, beratBaruKg: number, buktiInvoiceDataUrl?: string, buktiInvoiceFileName?: string) => Promise<void>;
}) {
  const defaultRate = hargaKainRate(hargaKain, hargaKainPks, claim.supplier, claim.warna, claim.grossKg);
  const [rateBaru, setRateBaru] = useState(defaultRate || rateLama);
  const [beratBaru, setBeratBaru] = useState(0);
  const [buktiDataUrl, setBuktiDataUrl] = useState<string | undefined>(undefined);
  const [buktiFileName, setBuktiFileName] = useState<string | undefined>(undefined);
  const [buktiError, setBuktiError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const beratLama = claim.grossKg;
  const preview = claimReplacementValue(rateBaru, beratBaru, rateLama, beratLama);
  const canSubmit = rateBaru > 0 && beratBaru > 0 && !submitting;

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
      await onSubmit(rateBaru, beratBaru, buktiDataUrl, buktiFileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[440px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">
            Buat PV Pengganti — {claim.warna} · {claim.lengan}, roll #{claim.rollIndex + 1}
          </span>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between font-sans text-[11px] text-text-muted">
            <span>
              PO Reference (lama): <span className="font-mono font-medium text-text-primary">{claim.invoiceId}</span> · {claim.supplier}
            </span>
            <span>PV baru: otomatis</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Rate baru (Rp/kg)</label>
              <NumberInput value={rateBaru} onChange={setRateBaru} currency placeholder="Rp 113.000" className="input mt-1" />
            </div>
            <div>
              <label className="block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Berat roll (kg)</label>
              <NumberInput value={beratBaru} onChange={setBeratBaru} decimals={2} commaOnly startEmptyIfZero placeholder="25,07" className="input mt-1" />
            </div>
          </div>

          <label className="mt-3 block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Bukti Invoice (PDF)</label>
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
              <span>Nilai PV lama</span>
              <span className="font-mono">{formatRupiah(preview.kredit)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span>Nilai PV baru</span>
              <span className="font-mono">{formatRupiah(preview.nilaiBaru)}</span>
            </div>
            <div className={"flex items-center justify-between px-3 py-2 font-sans text-[11.5px] font-semibold " + (preview.selisih >= 0 ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg")}>
              <span>Selisih</span>
              <span className="font-mono">
                {preview.selisih >= 0 ? "+" : "−"}
                {formatRupiah(Math.abs(preview.selisih))}
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
            {submitting ? "Menyimpan…" : "Buat PV Pengganti"}
          </button>
        </div>
      </div>
    </div>
  );
}
