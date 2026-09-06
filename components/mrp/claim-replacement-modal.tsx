"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { claimReplacementValue, formatDecimal, formatRupiah, hargaKainRate } from "@/lib/mrp/derive";
import type { HargaKainPksRow, HargaKainRow } from "@/lib/mrp/masterData";
import type { MaterialClaimRow } from "@/lib/mrp/derive";

/** Revisi 2026-09-06: modal "Buat PV Pengganti" -- procurement menyelesaikan klaim selisih berat
 *  lewat retur + pesan ulang (BUKAN cuma tukar roll apa adanya). Rate & berat SENGAJA tidak
 *  dikunci ke PV lama (ikut harga terkini, lihat diskusi konsep dengan owner) -- preview di bawah
 *  cuma ilustrasi "kalau kredit retur ini nanti dipakai PENUH untuk PV ini", BUKAN netting
 *  otomatis -- saldo deposit yang benar-benar tercatat SELALU dipakai manual belakangan oleh
 *  Finance, bisa untuk invoice mana pun ke supplier ini (lihat payment-panel.tsx). */
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
  onSubmit: (rateBaru: number, beratBaruKg: number, note: string) => Promise<void>;
}) {
  const defaultRate = hargaKainRate(hargaKain, hargaKainPks, claim.supplier, claim.warna, claim.grossKg);
  const [rateBaru, setRateBaru] = useState(defaultRate || rateLama);
  const [beratBaru, setBeratBaru] = useState(0);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const beratLama = claim.grossKg;
  const preview = claimReplacementValue(rateBaru, beratBaru, rateLama, beratLama);
  const canSubmit = rateBaru > 0 && beratBaru > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(rateBaru, beratBaru, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B131B]/45 p-4">
      <div className="w-full max-w-[480px] overflow-hidden rounded-[9px] bg-surface-card shadow-[0_12px_32px_rgba(11,19,27,.28)]">
        <div className="flex items-center gap-2.5 bg-info-bg px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-accent-blue" />
          <span className="font-sans text-xs font-semibold text-info-fg">
            Buat PV Pengganti — {claim.warna} · {claim.lengan}, roll #{claim.rollIndex + 1}
          </span>
        </div>
        <div className="px-5 py-4">
          <div className="rounded-md border border-[#DDE4EB] bg-[#F7F9FB] px-3 py-2.5 font-sans text-[11px] leading-[1.5] text-text-muted">
            Roll ini diretur ke <b>{claim.supplier}</b> (invoice {claim.invoiceId}, berat invoice lama {formatDecimal(beratLama)} kg). Isi rate & berat PV
            pengganti sesuai yang BENAR-BENAR diinvoice sekarang — boleh beda dari harga lama, sistem TIDAK memotongnya otomatis dari saldo apa pun.
          </div>

          <label className="mt-3 block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Rate baru (Rp / kg)</label>
          <NumberInput value={rateBaru} onChange={setRateBaru} currency placeholder="Rp 113.000" className="input mt-1" />

          <label className="mt-3 block font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Berat roll pengganti (kg)</label>
          <NumberInput value={beratBaru} onChange={setBeratBaru} decimals={2} commaOnly startEmptyIfZero placeholder="25,07" className="input mt-1" />
          <div className="mt-0.5 font-sans text-[10px] text-text-muted">Pakai koma untuk desimal (mis. 25,07) — berat sesuai yang diinvoice supplier untuk roll pengganti ini.</div>

          <div className="mt-3 overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span>Nilai PV lama (yang diretur)</span>
              <span className="font-mono">{formatRupiah(preview.kredit)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
              <span>Nilai PV pengganti (ditagih penuh, seperti invoice biasa)</span>
              <span className="font-mono">{formatRupiah(preview.nilaiBaru)}</span>
            </div>
            <div className={"px-3 py-2 font-sans text-[11.5px] font-semibold " + (preview.selisih >= 0 ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg")}>
              {preview.selisih >= 0 ? (
                <>Kalau saldo kredit di atas nanti dipakai penuh untuk PV ini: kekurangan bayar {formatRupiah(preview.selisih)}.</>
              ) : (
                <>Kalau saldo kredit di atas nanti dipakai penuh untuk PV ini: sisa {formatRupiah(-preview.selisih)} tetap jadi saldo deposit {claim.supplier}.</>
              )}
            </div>
          </div>
          <div className="mt-1.5 font-sans text-[10px] leading-[1.4] text-text-muted">
            Ilustrasi saja — kredit {formatRupiah(preview.kredit)} SELALU dicatat penuh ke saldo deposit {claim.supplier} begitu PV ini dibuat, dan baru
            benar-benar dipakai kalau Finance memilihnya manual saat membayar (invoice ini atau invoice lain ke supplier yang sama, kapan saja).
          </div>

          <label className="mt-3 block font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Catatan (opsional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: no. PO reorder / referensi WA supplier"
            rows={2}
            className="mt-1.5 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-sans text-[12.5px] text-text-primary"
          />
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
