"use client";

import { useRef, useState } from "react";
import { parseMrpImportFile, type ParsedMrpImport } from "@/lib/mrp/parseImport";
import { formatPcs } from "@/lib/mrp/derive";

export function ImportDropzone({ onConfirm }: { onConfirm: (parsed: ParsedMrpImport, customId?: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedMrpImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mrpNo, setMrpNo] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setParsed(null);
    setSuccess(null);
    setFileName(file.name);
    try {
      const result = await parseMrpImportFile(file);
      setParsed(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membaca file.");
    } finally {
      setLoading(false);
    }
  }

  function confirmImport() {
    if (!parsed) return;
    onConfirm(parsed, mrpNo.trim() || undefined);
    setSuccess((mrpNo.trim() || "MRP baru") + " berhasil ditambahkan ke tabel MRP saya di bawah ↓");
    setParsed(null);
    setFileName(null);
    setMrpNo("");
    window.setTimeout(() => setSuccess(null), 5000);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-5 py-3.5 font-sans text-[13px] font-semibold text-text-primary">Import dokumen MRP</div>
      <div className="p-5">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-[#CBD5DF] bg-[#F7F9FB] px-6 py-8 text-center"
        >
          <span className="font-sans text-[12.5px] font-semibold text-action-primary">Klik untuk pilih file, atau drag &amp; drop</span>
          <span className="font-sans text-[11.5px] text-text-muted">Format .xlsx sesuai template MRP (sheet &quot;MRP Template&quot; + &quot;Aduan Pola&quot;)</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </div>

        {loading && <div className="mt-3 font-sans text-xs text-text-muted">Membaca {fileName}…</div>}
        {error && <div className="mt-3 rounded-md border border-[#EFC9C4] bg-danger-bg px-3.5 py-2.5 font-sans text-xs text-danger-fg">{error}</div>}
        {success && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[#B7DFC5] bg-success-bg px-3.5 py-2.5 font-sans text-xs font-medium text-success-fg">
            <span>✓</span>
            {success}
          </div>
        )}

        {parsed && (
          <div className="mt-4">
            <div className="mb-2 font-sans text-xs font-semibold text-text-primary">Preview — {fileName}</div>

            <div className="mb-3 max-w-[280px]">
              <label className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">No. MRP</label>
              <input
                value={mrpNo}
                onChange={(e) => setMrpNo(e.target.value)}
                placeholder="Wajib diisi, mis. MRP-2026-014"
                className="mt-1 w-full rounded-md border border-[#DDE4EB] px-[11px] py-[9px] font-mono text-[12.5px] font-medium text-text-primary"
              />
            </div>

            <div className="overflow-hidden rounded-md border border-border-subtle">
              <div className="grid grid-cols-6 gap-x-3 bg-[#F7F9FB] px-3.5 py-2 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
                <span>Warna</span>
                <span>Lengan</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rib (kg)</span>
                <span className="text-right">Roll</span>
                <span>Vendor produksi</span>
              </div>
              {parsed.lenganGroups.map((g) => (
                <div key={g.id} className="grid grid-cols-6 items-center gap-x-3 border-t border-[#F1F4F7] px-3.5 py-2 font-sans text-xs text-[#31414F]">
                  <span>{g.warna}</span>
                  <span>{g.lengan}</span>
                  <span className="text-right font-mono">{formatPcs(g.totalQty)}</span>
                  <span className="text-right font-mono">{g.ribKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })}</span>
                  <span className="text-right font-mono">{g.rollEstimate}</span>
                  <span className="font-mono">{g.vendorDefault}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-text-muted">{parsed.aduanRows.length} baris aduan pola terbaca</div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={confirmImport}
                disabled={!mrpNo.trim()}
                className="rounded-md bg-action-primary px-3.5 py-[9px] font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Konfirmasi import
              </button>
              <button onClick={() => setParsed(null)} className="rounded-md border border-[#CBD5DF] px-3.5 py-[9px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
