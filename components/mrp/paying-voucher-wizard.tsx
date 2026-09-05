"use client";

import { useState } from "react";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { aduanRibAllocationPreview, formatRupiah } from "@/lib/mrp/derive";
import type { MrpDetail } from "@/lib/mrp/store";
import type { AddBuyItem, ColorEntry, Lengan, MaterialPO } from "@/lib/mrp/types";

const ADD_BUY_ITEMS = ["Rib", "Kerah", "Manset", "Bur"];
const AUTO_RIB_REMARK = "Otomatis dari Aduan Pola";

function remainingByColor(po: MaterialPO, entries: ColorEntry[]) {
  return po.colorBreakdown.map((c) => {
    const key = c.warna + "|" + c.lengan;
    const alreadyInvoiced = po.invoicedByColor[key] ?? 0;
    const inThisVoucher = entries.filter((e) => e.warna === c.warna && e.lengan === c.lengan).reduce((a, e) => a + e.rolls.length, 0);
    return { ...c, remaining: c.rollCount - alreadyInvoiced - inThisVoucher };
  });
}

type WarnaGroup = { warna: string; totalRemaining: number; lenganBreakdown: { lengan: Lengan; remaining: number }[] };

function remainingByWarna(po: MaterialPO, entries: ColorEntry[]): WarnaGroup[] {
  const perColor = remainingByColor(po, entries);
  const map = new Map<string, WarnaGroup>();
  for (const c of perColor) {
    const g = map.get(c.warna) ?? { warna: c.warna, totalRemaining: 0, lenganBreakdown: [] };
    g.totalRemaining += Math.max(0, c.remaining);
    g.lenganBreakdown.push({ lengan: c.lengan, remaining: Math.max(0, c.remaining) });
    map.set(c.warna, g);
  }
  return Array.from(map.values());
}

function splitRollsAcrossLengan(rolls: number[], breakdown: { lengan: Lengan; remaining: number }[]) {
  let idx = 0;
  const result: { lengan: Lengan; rolls: number[] }[] = [];
  for (const b of breakdown) {
    if (b.remaining <= 0 || idx >= rolls.length) continue;
    const take = Math.min(b.remaining, rolls.length - idx);
    if (take <= 0) continue;
    result.push({ lengan: b.lengan, rolls: rolls.slice(idx, idx + take) });
    idx += take;
  }
  return result;
}

export function PayingVoucherWizard({
  po,
  mrpDetails,
  onSubmit,
  onCancel,
}: {
  po: MaterialPO;
  mrpDetails: MrpDetail[];
  onSubmit: (input: {
    colorEntries: ColorEntry[];
    addBuys: AddBuyItem[];
    diskon: number;
    kodeTransaksi: string;
    noInvoiceVendor: string;
    buktiPvDataUrl?: string;
    buktiPvFileName?: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  // CATATAN: dulu tombol ini memanggil onSubmit tanpa menunggu hasilnya (fire-and-forget) --
  // kalau bookInvoice gagal (mis. sesi login sempat tidak valid), wizard tetap optimis
  // menganggap sukses (langsung tertutup, memicu banner "sisa roll") padahal TIDAK ADA yang
  // benar-benar tersimpan -- retry berikutnya kelihatan seperti "loop dari awal terus" karena
  // roll count memang tidak pernah berkurang. Sekarang di-`await` + tampilkan error kalau gagal,
  // wizard TIDAK tertutup sampai submit benar-benar sukses.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [entries, setEntries] = useState<ColorEntry[]>([]);
  // Auto-pilih warna pertama yang masih ada sisa roll, supaya field Harga/kg + Qty roll ready
  // langsung tampil begitu wizard dibuka — tidak perlu klik pilih warna dulu.
  const [activeKey, setActiveKey] = useState<string | null>(() => remainingByWarna(po, []).find((g) => g.totalRemaining > 0)?.warna ?? null);
  const [hargaPerRoll, setHargaPerRoll] = useState(0);
  const [qtyRoll, setQtyRoll] = useState(1);
  const [draftRolls, setDraftRolls] = useState<number[] | null>(null);
  const [addBuys, setAddBuys] = useState<AddBuyItem[]>([]);
  const [diskon, setDiskon] = useState(0);
  // Dulu auto-generate "TRX-xxxx" acak dan langsung dipakai sebagai isi field -- sekarang kosong,
  // cuma format 4-digit-nya yang ditampilkan sebagai placeholder (lihat <input> di bawah), user
  // wajib isi sendiri.
  const [kodeTransaksi, setKodeTransaksi] = useState("");
  const [noInvoiceVendor, setNoInvoiceVendor] = useState("");
  const [buktiPvDataUrl, setBuktiPvDataUrl] = useState<string | undefined>(undefined);
  const [buktiPvFileName, setBuktiPvFileName] = useState<string | undefined>(undefined);
  const [buktiPvError, setBuktiPvError] = useState("");

  function handleBuktiPvChange(file: File | null) {
    setBuktiPvError("");
    if (!file) {
      setBuktiPvDataUrl(undefined);
      setBuktiPvFileName(undefined);
      return;
    }
    if (file.type !== "application/pdf") {
      setBuktiPvError("File harus berformat PDF.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBuktiPvDataUrl(reader.result as string);
      setBuktiPvFileName(file.name);
    };
    reader.onerror = () => setBuktiPvError("Gagal membaca file, coba lagi.");
    reader.readAsDataURL(file);
  }

  const warnaGroups = remainingByWarna(po, entries);
  const activeGroup = warnaGroups.find((g) => g.warna === activeKey);

  const materialTotal = entries.reduce((a, e) => a + e.hargaPerRoll * e.rolls.reduce((s, w) => s + w, 0), 0);
  const addBuyTotal = addBuys.reduce((a, b) => a + b.totalHarga, 0);
  const total = materialTotal + addBuyTotal - diskon;

  function startColor(warna: string) {
    setActiveKey(warna);
    setHargaPerRoll(0);
    setQtyRoll(1);
    setDraftRolls(null);
  }

  function editEntry(index: number) {
    const entry = entries[index];
    setEntries((prev) => prev.filter((_, i) => i !== index));
    setActiveKey(entry.warna);
    setHargaPerRoll(entry.hargaPerRoll);
    setQtyRoll(entry.rolls.length);
    setDraftRolls(null);
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function generateRollBoxes() {
    if (!activeGroup) return;
    const qty = Math.max(1, Math.min(qtyRoll, activeGroup.totalRemaining));
    setDraftRolls(Array(qty).fill(25.0));
  }

  // Dulu add-buy "Rib" cuma muncul kalau user klik "+ Tambah add buy" sendiri (opsional, gampang
  // kelupaan) — sekarang otomatis ditambahkan begitu 1 warna selesai disimpan di PV ini, kalau
  // warna itu punya alokasi Rib dari Aduan Pola & belum pernah di-add-buy-kan sebelumnya. Item
  // add buy LAIN (Kerah/Manset/Bur) TETAP manual/opsional, cuma Rib yang berubah jadi otomatis.
  function autoAddRibForWarna(warna: string, entriesForCalc: ColorEntry[], currentAddBuys: AddBuyItem[]): AddBuyItem[] {
    const alreadyAdded = currentAddBuys.some((b) => b.item === "Rib" && b.warna === warna && b.remark === AUTO_RIB_REMARK);
    if (alreadyAdded) return currentAddBuys;
    const rollQtyForWarna = entriesForCalc.filter((x) => x.warna === warna).reduce((s, x) => s + x.rolls.length, 0);
    const preview = aduanRibAllocationPreview(po.mrpId, warna, rollQtyForWarna, mrpDetails);
    if (preview.totalRibKg <= 0) return currentAddBuys;
    return [
      ...currentAddBuys,
      {
        id: "ab-rib-" + warna + "-" + Date.now(),
        item: "Rib",
        warna,
        beratKg: Math.round(preview.totalRibKg * 1000) / 1000,
        totalHarga: 0,
        remark: AUTO_RIB_REMARK,
      },
    ];
  }

  function saveColorEntry() {
    if (!activeGroup || !draftRolls) return;
    const splits = splitRollsAcrossLengan(draftRolls, activeGroup.lenganBreakdown);
    const newEntries: ColorEntry[] = splits.map((s) => ({ warna: activeGroup.warna, lengan: s.lengan, hargaPerRoll, rolls: s.rolls }));
    const updatedEntries = [...entries, ...newEntries];
    setEntries(updatedEntries);
    setAddBuys((prev) => autoAddRibForWarna(activeGroup.warna, updatedEntries, prev));

    // Auto-lanjut ke warna berikutnya yang masih ada sisa roll (kalau ada), supaya tidak perlu
    // klik "pilih warna" lagi untuk warna selanjutnya.
    const nextGroups = remainingByWarna(po, updatedEntries);
    setActiveKey(nextGroups.find((g) => g.totalRemaining > 0)?.warna ?? null);
    setDraftRolls(null);
  }

  function addAddBuy() {
    // Fallback jaga-jaga: Rib sekarang otomatis ditambahkan begitu warna disimpan (lihat
    // autoAddRibForWarna dipanggil dari saveColorEntry), jadi normalnya tombol ini langsung
    // nambah baris kosong. Tapi kalau somehow ada warna yang rib-nya belum ke-add (mis. data
    // lama), cek dulu di sini sebelum nambah baris kosong biasa.
    for (const e of entries) {
      const before = addBuys;
      const after = autoAddRibForWarna(e.warna, entries, before);
      if (after !== before) {
        setAddBuys(after);
        return;
      }
    }
    setAddBuys((prev) => [...prev, { id: "ab-" + Date.now(), item: ADD_BUY_ITEMS[0], warna: "", beratKg: 0, totalHarga: 0, remark: "" }]);
  }

  function updateAddBuy(id: string, patch: Partial<AddBuyItem>) {
    setAddBuys((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  // Harga add buy (Rib/Kerah/Manset/Bur) diinput sebagai harga PER KG, bukan total langsung —
  // totalHarga (dipakai di semua kalkulasi lain: Total Pembelian di sini, hppRowsForInvoice untuk
  // COGS bahan) selalu di-DERIVE = beratKg * hargaPerKg, dihitung ulang otomatis begitu salah satu
  // dari keduanya diubah, supaya tidak ada celah salah input "total" padahal maksudnya rate/kg.
  function updateAddBuyBerat(id: string, beratKg: number) {
    setAddBuys((prev) => prev.map((b) => (b.id === id ? { ...b, beratKg, totalHarga: Math.round(beratKg * (b.hargaPerKg ?? 0)) } : b)));
  }
  function updateAddBuyHargaPerKg(id: string, hargaPerKg: number) {
    setAddBuys((prev) => prev.map((b) => (b.id === id ? { ...b, hargaPerKg, totalHarga: Math.round(b.beratKg * hargaPerKg) } : b)));
  }

  function removeAddBuy(id: string) {
    setAddBuys((prev) => prev.filter((b) => b.id !== id));
  }

  const canSubmit = (entries.length > 0 || addBuys.length > 0) && kodeTransaksi.trim() && !!buktiPvDataUrl && !submitting;

  async function handleSubmit() {
    setSubmitError("");
    setSubmitting(true);
    try {
      await onSubmit({ colorEntries: entries, addBuys, diskon, kodeTransaksi, noInvoiceVendor, buktiPvDataUrl, buktiPvFileName });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal membuat Paying Voucher, coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-border-subtle bg-[#F7F9FB] px-5 py-4">
      <div className="font-sans text-[12.5px] font-semibold text-text-primary">Paying Voucher — {po.id}</div>

      {entries.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-border-subtle bg-white">
          <div className="grid grid-cols-5 gap-2 bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
            <span>Warna</span>
            <span className="text-right">Roll</span>
            <span className="text-right">Harga/roll</span>
            <span className="text-right">Subtotal</span>
            <span className="text-right">Aksi</span>
          </div>
          {entries.map((e, i) => (
            <div key={i} className="grid grid-cols-5 items-center gap-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F]">
              <span>
                {e.warna} <span className="text-text-muted">· {e.lengan}</span>
              </span>
              <span className="text-right font-mono">{e.rolls.length}</span>
              <span className="text-right font-mono">{formatRupiah(e.hargaPerRoll)}</span>
              <span className="text-right font-mono">{formatRupiah(e.hargaPerRoll * e.rolls.reduce((s, w) => s + w, 0))}</span>
              <span className="flex justify-end gap-2">
                <Button onClick={() => editEntry(i)} variant="accent" size="xs">
                  Edit
                </Button>
                <Button onClick={() => removeEntry(i)} variant="danger" size="xs">
                  Hapus
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {!activeKey && warnaGroups.some((g) => g.totalRemaining > 0) && (
        <div className="mt-3">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Pilih warna</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {warnaGroups
              .filter((g) => g.totalRemaining > 0)
              .map((g) => (
                <button
                  key={g.warna}
                  onClick={() => startColor(g.warna)}
                  className="rounded-md border border-[#CBD5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-action-primary"
                >
                  {g.warna} ({g.totalRemaining} roll sisa)
                </button>
              ))}
          </div>
        </div>
      )}

      {activeGroup && !draftRolls && (
        <div className="mt-3 rounded-md border border-[#CFE0EF] bg-info-bg p-3">
          <div className="font-sans text-xs font-semibold text-info-fg">
            {activeGroup.warna} — maks {activeGroup.totalRemaining} roll
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Harga / kg</div>
              <NumberInput value={hargaPerRoll} onChange={setHargaPerRoll} currency startEmptyIfZero placeholder="Rp 45.000" className="input mt-1" />
            </div>
            <div>
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Qty roll ready</div>
              <NumberInput value={qtyRoll} onChange={setQtyRoll} decimals={0} className="input mt-1" />
            </div>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button onClick={generateRollBoxes} className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">
              OK
            </button>
            <button onClick={() => setActiveKey(null)} className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[7px] font-sans text-xs font-semibold text-action-primary">
              Batal
            </button>
          </div>
        </div>
      )}

      {activeGroup && draftRolls && (
        <div className="mt-3 rounded-md border border-[#CFE0EF] bg-info-bg p-3">
          <div className="font-sans text-xs font-semibold text-info-fg">
            Berat per roll — {activeGroup.warna} ({draftRolls.length} roll)
          </div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {draftRolls.map((w, i) => (
              <div key={i}>
                <div className="font-sans text-[10px] text-text-muted">Roll {i + 1} (kg)</div>
                <NumberInput
                  value={w}
                  decimals={2}
                  commaOnly
                  onChange={(v) => setDraftRolls((prev) => prev!.map((x, idx) => (idx === i ? v : x)))}
                  className="input mt-0.5"
                />
                <div className="mt-0.5 font-sans text-[9px] text-text-muted">pakai koma untuk desimal (mis. 25,5)</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button onClick={saveColorEntry} className="rounded-md bg-action-primary px-3 py-[7px] font-sans text-xs font-semibold text-white">
              Simpan warna ini
            </button>
            <button onClick={() => setDraftRolls(null)} className="rounded-md border border-[#CBD5DF] bg-white px-3 py-[7px] font-sans text-xs font-semibold text-action-primary">
              Kembali
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center">
          <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Add buy (opsional)</div>
          <button onClick={addAddBuy} className="ml-auto rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[5px] font-sans text-[11px] font-semibold text-text-muted">
            + Tambah add buy
          </button>
        </div>
        {addBuys.map((b) => (
          <div key={b.id} className="mt-2 grid grid-cols-7 items-end gap-2 rounded-md border border-border-subtle bg-white p-2.5">
            <div>
              <div className="font-sans text-[10px] text-text-muted">Item</div>
              <select value={b.item} onChange={(e) => updateAddBuy(b.id, { item: e.target.value })} className="input mt-0.5">
                {ADD_BUY_ITEMS.map((it) => (
                  <option key={it} value={it}>
                    {it}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="font-sans text-[10px] text-text-muted">Warna</div>
              <input value={b.warna} onChange={(e) => updateAddBuy(b.id, { warna: e.target.value })} className="input mt-0.5" />
            </div>
            <div>
              <div className="font-sans text-[10px] text-text-muted">Berat (kg)</div>
              <NumberInput value={b.beratKg} decimals={2} commaOnly onChange={(v) => updateAddBuyBerat(b.id, v)} className="input mt-0.5" />
              <div className="mt-0.5 font-sans text-[9px] text-text-muted">pakai koma untuk desimal (mis. 25,5)</div>
            </div>
            <div>
              <div className="font-sans text-[10px] text-text-muted">Harga/kg</div>
              <NumberInput value={b.hargaPerKg ?? 0} onChange={(v) => updateAddBuyHargaPerKg(b.id, v)} currency startEmptyIfZero placeholder="Rp 0" className="input mt-0.5" />
            </div>
            <div>
              <div className="font-sans text-[10px] text-text-muted">Subtotal</div>
              <div className="input mt-0.5 flex items-center bg-[#F7F9FB] font-mono">{formatRupiah(b.totalHarga)}</div>
            </div>
            <div>
              <div className="font-sans text-[10px] text-text-muted">Remark</div>
              <input value={b.remark} onChange={(e) => updateAddBuy(b.id, { remark: e.target.value })} className="input mt-0.5" />
            </div>
            <Button onClick={() => removeAddBuy(b.id)} variant="danger" size="xs">
              Hapus
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <div>
          <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">No invoice vendor material</div>
          <input value={noInvoiceVendor} onChange={(e) => setNoInvoiceVendor(e.target.value)} className="input mt-1" placeholder="No. invoice dari supplier" />
        </div>
        <div>
          <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Diskon</div>
          <NumberInput value={diskon} onChange={setDiskon} currency startEmptyIfZero placeholder="Rp 0" className="input mt-1" />
        </div>
        <div>
          <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Kode transaksi</div>
          <input
            value={kodeTransaksi}
            onChange={(e) => setKodeTransaksi(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="1234"
            maxLength={4}
            inputMode="numeric"
            className="input mt-1"
          />
        </div>
        <div>
          <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Total pembelian</div>
          <div className="input mt-1 flex items-center bg-white font-mono font-semibold">{formatRupiah(total)}</div>
        </div>
      </div>

      <div className="mt-3">
        {/* Wajib diisi sebelum PV bisa diajukan (lihat canSubmit) — Finance nanti bisa lihat
           bukti ini juga di halaman Payment (lihat components/finance/payment-panel.tsx). */}
        <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          Bukti Paying Voucher (PDF) <span className="text-danger-fg">*wajib</span>
        </div>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => handleBuktiPvChange(e.target.files?.[0] ?? null)}
          className="input mt-1 file:mr-2.5 file:rounded file:border-0 file:bg-info-bg file:px-2.5 file:py-1 file:font-sans file:text-[11px] file:font-semibold file:text-info-fg"
        />
        {buktiPvFileName && <div className="mt-1 font-sans text-[11px] text-success-fg">✓ {buktiPvFileName} terupload.</div>}
        {buktiPvError && <div className="mt-1 font-sans text-[11px] text-danger-fg">{buktiPvError}</div>}
      </div>

      {submitError && <div className="mt-2 font-sans text-[11.5px] font-medium text-danger-fg">{submitError}</div>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => canSubmit && handleSubmit()}
          disabled={!canSubmit}
          title={!buktiPvDataUrl ? "Upload bukti Paying Voucher (PDF) dulu" : undefined}
          className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* Item revisi 2026-09-05: tidak lagi menampilkan status "Memproses..." -- canSubmit
             (sudah memasukkan `!submitting`) tetap mencegah dobel klik, cuma tidak lagi terlihat
             user; PV baru tampil di "Riwayat Paying Voucher" begitu backgroundRefresh selesai. */}
          Bayar (Paying Voucher)
        </button>
        <button onClick={onCancel} disabled={submitting} className="rounded-md border border-[#CBD5DF] px-3.5 py-2 font-sans text-xs font-semibold text-action-primary disabled:cursor-not-allowed disabled:opacity-50">
          Batal
        </button>
      </div>
    </div>
  );
}
