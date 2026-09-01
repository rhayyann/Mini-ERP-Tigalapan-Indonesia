"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { availableFgToShip, ekspedisiPrice, formatDate, formatDecimal, formatRupiah, mrpIdsWithUnpackedFg } from "@/lib/mrp/derive";
import { EKSPEDISI_LIST, VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { DeliveryKoliItem, Lengan, ShippableKind, Usia } from "@/lib/mrp/types";

const USIA_LABEL: Record<Usia, string> = { KIDS: "Kids", DEWASA: "Dewasa" };

const PRODUCT_KIND_OPTIONS: { value: ShippableKind; label: string }[] = [
  { value: "FG", label: "Finish Good" },
  { value: "REJECT", label: "Reject" },
  { value: "REWORK", label: "Rework" },
];

function emptyItem(): DeliveryKoliItem {
  return { warna: "", lengan: "PENDEK", size: "", qty: 0, kind: "FG" };
}

function kindLabel(kind: ShippableKind): string {
  return PRODUCT_KIND_OPTIONS.find((opt) => opt.value === kind)?.label ?? kind;
}

/** Ringkasan singkat "Isi" koli untuk tampilan default — daftar lengkap per item (bisa banyak
 *  baris & bikin sel meluber) sekarang cuma muncul kalau baris di-klik untuk expand, lihat
 *  `ItemsDetailPanel` di bawah. */
function summarizeItems(items: DeliveryKoliItem[]): string {
  if (items.length === 0) return "—";
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  return `${items.length} varian · ${totalQty} pcs`;
}

function ItemsDetailPanel({ items }: { items: DeliveryKoliItem[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
      <div className="grid grid-cols-5 gap-x-2 border-b border-[#E4E8EE] bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
        <span>Jenis produk</span>
        <span>Warna</span>
        <span>Lengan</span>
        <span>Size / Usia</span>
        <span className="text-right">Qty</span>
      </div>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-5 gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F] last:border-b-0">
          <span>{kindLabel(it.kind ?? "FG")}</span>
          <span>{it.warna}</span>
          <span>{it.lengan}</span>
          <span>
            {it.size}
            {it.usia ? " · " + USIA_LABEL[it.usia] : ""}
          </span>
          <span className="text-right font-mono font-semibold">{it.qty} pcs</span>
        </div>
      ))}
    </div>
  );
}

function PengirimanContent({ vendorId }: { vendorId: string }) {
  const productionResults = useMrpStore((s) => s.productionResults);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const createDeliveryKoli = useMrpStore((s) => s.createDeliveryKoli);
  const updateDeliveryKoli = useMrpStore((s) => s.updateDeliveryKoli);
  const setKoliWeight = useMrpStore((s) => s.setKoliWeight);
  const markKoliDelivered = useMrpStore((s) => s.markKoliDelivered);

  const mrpIds = mrpIdsWithUnpackedFg(vendorId, productionResults, deliveryKolis);

  const [mrpId, setMrpId] = useState("");
  const [noKoli, setNoKoli] = useState("");
  const [items, setItems] = useState<DeliveryKoliItem[]>([emptyItem()]);
  const [weightDraft, setWeightDraft] = useState<Record<string, number>>({});
  const [editingKoliId, setEditingKoliId] = useState<string | null>(null);
  // Klik baris "Koli belum dikirim"/"Riwayat pengiriman" untuk expand/collapse rincian isi koli
  // per item — id koli unik lintas kedua tabel jadi aman pakai 1 Set gabungan.
  const [expandedKoli, setExpandedKoli] = useState<Set<string>>(new Set());

  function toggleKoliExpanded(koliId: string) {
    setExpandedKoli((prev) => {
      const next = new Set(prev);
      if (next.has(koliId)) next.delete(koliId);
      else next.add(koliId);
      return next;
    });
  }

  // MRP yang lagi dipilih di form ini bisa "habis" (semua FG/Reject/Rework sudah masuk koli)
  // begitu koli TERAKHIR untuk MRP itu disimpan — begitu itu terjadi, MRP-nya hilang dari
  // `mrpIds` (lihat mrpIdsWithUnpackedFg), tapi state `mrpId` di form ini TIDAK ikut ter-reset
  // sendiri. Akibatnya dropdown <select> tampil kosong (value-nya tidak cocok ke option manapun,
  // browser default balik ke placeholder), tapi bagian "Isi koli" di bawahnya tetap nyangkut ke
  // MRP lama yang sudah tidak relevan. Reset form-nya begitu ini kedeteksi (kecuali lagi edit
  // koli — biarkan edit tetap jalan meski MRP-nya sudah habis di form "buat baru").
  useEffect(() => {
    if (mrpId && !editingKoliId && !mrpIds.includes(mrpId)) {
      setMrpId("");
      setItems([emptyItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrpId, editingKoliId, mrpIds.join(",")]);

  function availableFor(kind: ShippableKind) {
    return mrpId ? availableFgToShip(mrpId, vendorId, productionResults, deliveryKolis, editingKoliId ?? undefined, kind) : [];
  }

  const availableByKind: Record<ShippableKind, ReturnType<typeof availableFgToShip>> = {
    FG: availableFor("FG"),
    REJECT: availableFor("REJECT"),
    REWORK: availableFor("REWORK"),
  };

  const anyAvailable = PRODUCT_KIND_OPTIONS.some((opt) => availableByKind[opt.value].length > 0);

  function warnaOptionsFor(kind: ShippableKind) {
    return Array.from(new Set(availableByKind[kind].map((r) => r.warna)));
  }

  function draftedQtyExcluding(idx: number, kind: ShippableKind, warna: string, lengan: Lengan, size: string, usia: Usia | undefined) {
    return items.reduce(
      (sum, it, i) => (i !== idx && it.kind === kind && it.warna === warna && it.lengan === lengan && it.size === size && it.usia === usia ? sum + it.qty : sum),
      0
    );
  }

  function remainingFor(idx: number, kind: ShippableKind, warna: string, lengan: Lengan, size: string, usia: Usia | undefined) {
    const base = availableByKind[kind].find((r) => r.warna === warna && r.lengan === lengan && r.size === size && r.usia === usia)?.available ?? 0;
    return Math.max(0, base - draftedQtyExcluding(idx, kind, warna, lengan, size, usia));
  }

  function usiaOptionsFor(warna: string, lengan: Lengan, size: string, kind: ShippableKind): (Usia | undefined)[] {
    return Array.from(new Set(availableByKind[kind].filter((r) => r.warna === warna && r.lengan === lengan && r.size === size).map((r) => r.usia)));
  }

  function firstSizeWithRemaining(idx: number, kind: ShippableKind, warna: string, lengan: Lengan): string {
    return sizeOptionsFor(idx, warna, lengan, kind)[0] ?? "";
  }

  function firstUsiaWithRemaining(idx: number, kind: ShippableKind, warna: string, lengan: Lengan, size: string): Usia | undefined {
    const opts = usiaOptionsFor(warna, lengan, size, kind);
    return opts.find((u) => remainingFor(idx, kind, warna, lengan, size, u) > 0) ?? opts[0];
  }

  function defaultItemForMrp(id: string): DeliveryKoliItem {
    // idx -1 tidak pernah cocok dengan index baris manapun di `items` — draftedQtyExcluding jadi
    // ikut menghitung qty SEMUA baris draft saat ini (baris baru ini belum ada di `items`), pas
    // dipakai untuk baris baru yang mau ditambahkan (lihat addItem).
    const NEW_ROW_IDX = -1;
    for (const opt of PRODUCT_KIND_OPTIONS) {
      const fg = id ? availableFgToShip(id, vendorId, productionResults, deliveryKolis, undefined, opt.value) : [];
      if (fg.length === 0) continue;
      // Cari kombinasi warna+lengan+size+usia PERTAMA yang sisanya masih > 0 (setelah dikurangi
      // draft baris lain) — SUDAH benar cek lintas warna, bukan cuma warna pertama yang ditemukan
      // (dulu: kalau warna pertama sudah habis semua size/lengan-nya, baris baru tetap jatuh ke
      // kombinasi warna pertama yang 0 sisa, bukan lanjut cari warna lain yang masih ada sisa).
      const picked =
        fg.find((r) => r.available - draftedQtyExcluding(NEW_ROW_IDX, opt.value, r.warna, r.lengan, r.size, r.usia) > 0) ?? fg[0];
      if (!picked) continue;
      return { warna: picked.warna, lengan: picked.lengan, size: picked.size, usia: picked.usia, qty: 0, kind: opt.value };
    }
    return { warna: "", lengan: "PENDEK", size: "", qty: 0, kind: "FG" };
  }

  function pickMrp(id: string) {
    setMrpId(id);
    setItems([defaultItemForMrp(id)]);
  }

  function editKoli(k: (typeof deliveryKolis)[number]) {
    setEditingKoliId(k.id);
    setMrpId(k.mrpId);
    setNoKoli(k.noKoli);
    setItems(k.items.length ? [...k.items] : [defaultItemForMrp(k.mrpId)]);
  }

  function cancelEdit() {
    setEditingKoliId(null);
    setMrpId("");
    setNoKoli("");
    setItems([emptyItem()]);
  }

  function updateItem(idx: number, patch: Partial<DeliveryKoliItem>) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if (patch.kind !== undefined) {
          next.warna = warnaOptionsFor(next.kind)[0] ?? "";
          next.lengan = lenganOptionsFor(next.warna, next.kind)[0] ?? "PENDEK";
          next.size = firstSizeWithRemaining(idx, next.kind, next.warna, next.lengan);
          next.usia = firstUsiaWithRemaining(idx, next.kind, next.warna, next.lengan, next.size);
          next.qty = 0;
        } else if (patch.warna !== undefined) {
          next.lengan = lenganOptionsFor(next.warna, next.kind)[0] ?? "PENDEK";
          next.size = firstSizeWithRemaining(idx, next.kind, next.warna, next.lengan);
          next.usia = firstUsiaWithRemaining(idx, next.kind, next.warna, next.lengan, next.size);
          next.qty = 0;
        } else if (patch.lengan !== undefined) {
          next.size = firstSizeWithRemaining(idx, next.kind, next.warna, next.lengan);
          next.usia = firstUsiaWithRemaining(idx, next.kind, next.warna, next.lengan, next.size);
          next.qty = 0;
        } else if (patch.size !== undefined) {
          next.usia = firstUsiaWithRemaining(idx, next.kind, next.warna, next.lengan, next.size);
          next.qty = 0;
        }
        return next;
      })
    );
  }

  function updateItemUsia(idx: number, usia: Usia | undefined) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, usia, qty: 0 } : it)));
  }

  function lenganOptionsFor(warna: string, kind: ShippableKind): Lengan[] {
    return Array.from(new Set(availableByKind[kind].filter((r) => r.warna === warna).map((r) => r.lengan)));
  }

  // Size yang qty sisanya sudah 0 UNTUK warna+lengan baris ini (habis dialokasikan baris lain di
  // draft koli ini) DIKELUARKAN dari dropdown — kecuali itu size yang SEDANG dipilih baris ini
  // sendiri (supaya tidak hilang mendadak dari bawah user yang lagi pakai). Scoped ke warna+lengan
  // yang sudah dipilih di baris ini, jadi size yang sama untuk WARNA LAIN tetap muncul normal di
  // baris lain — cuma kombinasi yang benar-benar habis yang disembunyikan.
  function sizeOptionsFor(idx: number, warna: string, lengan: Lengan, kind: ShippableKind): string[] {
    const all = Array.from(new Set(availableByKind[kind].filter((r) => r.warna === warna && r.lengan === lengan).map((r) => r.size)));
    return all.filter((size) => {
      if (items[idx]?.size === size) return true;
      return usiaOptionsFor(warna, lengan, size, kind).some((u) => remainingFor(idx, kind, warna, lengan, size, u) > 0);
    });
  }

  function addItem() {
    setItems((prev) => [...prev, defaultItemForMrp(mrpId)]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    if (!mrpId || !noKoli.trim()) return;
    const validItems = items.filter((it) => it.warna.trim() && it.size.trim() && it.qty > 0);
    if (validItems.length === 0) return;
    if (editingKoliId) {
      const existing = deliveryKolis.find((k) => k.id === editingKoliId);
      updateDeliveryKoli(editingKoliId, { ekspedisi: existing?.ekspedisi ?? "", noKoli: noKoli.trim(), items: validItems });
      cancelEdit();
    } else {
      // Ekspedisi belum dipilih di sini — dipilih belakangan langsung di tabel "Koli belum dikirim".
      createDeliveryKoli({ mrpId, vendorProduksi: vendorId, ekspedisi: "", noKoli: noKoli.trim(), items: validItems });
      setNoKoli("");
      setItems([defaultItemForMrp(mrpId)]);
    }
  }

  function setKoliEkspedisi(koliId: string, ekspedisi: string) {
    const k = deliveryKolis.find((d) => d.id === koliId);
    if (!k) return;
    updateDeliveryKoli(koliId, { ekspedisi, noKoli: k.noKoli, items: k.items });
  }

  const myKolis = deliveryKolis.filter((k) => k.vendorProduksi === vendorId);
  const pending = myKolis.filter((k) => !k.deliveredAt);
  const delivered = myKolis.filter((k) => k.deliveredAt);

  function doDelivery(koliId: string) {
    const weight = weightDraft[koliId];
    const k = deliveryKolis.find((d) => d.id === koliId);
    if (!weight || weight <= 0 || !k?.ekspedisi) return;
    setKoliWeight(koliId, weight);
    markKoliDelivered(koliId);
  }

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/pengiriman"
      breadcrumb={["Dashboard", "Pengiriman"]}
      title="Pengiriman"
      subtitle="Buat koli pengiriman lalu masukkan berat koli sebelum delivery"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <div className="rounded-lg border border-border-subtle bg-surface-card px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="font-sans text-[13px] font-semibold text-text-primary">{editingKoliId ? `Edit koli — ${noKoli}` : "Buat koli baru"}</div>
          {editingKoliId && (
            <Button onClick={cancelEdit} variant="danger" size="xs" className="ml-auto">
              Batal edit
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Pilih MRP</div>
            <select value={mrpId} onChange={(e) => pickMrp(e.target.value)} disabled={!!editingKoliId} className="input mt-1 disabled:bg-[#F7F9FB] disabled:text-text-muted">
              <option value="">— pilih MRP —</option>
              {(editingKoliId && !mrpIds.includes(mrpId) ? [mrpId, ...mrpIds] : mrpIds).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            {mrpIds.length === 0 && !editingKoliId && <div className="mt-1 font-sans text-[11px] text-text-muted">Belum ada finish good yang siap dipacking.</div>}
          </div>
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">No koli</div>
            <input value={noKoli} onChange={(e) => setNoKoli(e.target.value)} placeholder="Contoh: KOLI-001" className="input mt-1" />
          </div>
        </div>
        <div className="mt-2 font-sans text-[11px] text-text-muted">Ekspedisi dipilih belakangan di tabel &quot;Koli belum dikirim&quot; di bawah.</div>

        {mrpId && (
          <div className="mt-4">
            <div className="flex items-center">
              <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">Isi koli</div>
              <button
                onClick={addItem}
                disabled={!anyAvailable}
                className="ml-auto rounded-md border border-dashed border-[#CBD5DF] px-2.5 py-[5px] font-sans text-[11px] font-semibold text-text-muted disabled:opacity-40"
              >
                + Tambah item
              </button>
            </div>
            {!anyAvailable && <div className="mt-2 font-sans text-xs text-text-muted">Tidak ada hasil produksi (FG/Reject/Rework) tersedia untuk MRP ini.</div>}
            {(() => {
              // Sisa yang BELUM masuk koli manapun untuk MRP ini — dihitung SETELAH dikurangi draft
              // baris di form ini juga (idx -1 = tidak exclude baris manapun, ikut semua draft),
              // supaya user tahu persis apa yang masih "nganggur" walau sudah lagi diisi sebagian.
              const unpacked = PRODUCT_KIND_OPTIONS.flatMap((opt) =>
                availableByKind[opt.value]
                  .map((r) => ({ ...r, kindLabel: kindLabel(opt.value), remaining: r.available - draftedQtyExcluding(-1, opt.value, r.warna, r.lengan, r.size, r.usia) }))
                  .filter((r) => r.remaining > 0)
              );
              if (unpacked.length === 0) return null;
              return (
                <div className="mt-2 overflow-hidden rounded-md border border-[#F0DFC2] bg-warning-bg">
                  <div className="px-3 py-2 font-sans text-[11.5px] font-semibold text-warning-fg">
                    {unpacked.length} item hasil produksi belum masuk koli manapun (termasuk draft ini)
                  </div>
                  {/* max-h + scroll — daftar ini bisa panjang kalau MRP-nya punya banyak
                      warna/size/usia sekaligus (puluhan-ratusan baris kalau item hasil
                      produksinya banyak); tanpa batas tinggi, box ini bisa mendorong form input
                      & tombol "Simpan koli" jauh ke bawah, harus scroll panjang dulu buat sampai
                      ke situ. Sama pola dengan bodyMaxHeight di DataTable (Master Data). */}
                  <div className="max-h-[260px] overflow-y-auto border-t border-[#F0DFC2]">
                    {unpacked.map((r, i) => (
                      <div
                        key={r.kindLabel + r.warna + r.lengan + r.size + (r.usia ?? "")}
                        className={"flex items-center justify-between px-3 py-1.5 font-sans text-[11.5px] text-warning-fg" + (i > 0 ? " border-t border-[#F0DFC2]/60" : "")}
                      >
                        <span>
                          {r.warna} · {r.lengan} · {r.size}
                          {r.usia && " · " + USIA_LABEL[r.usia]}
                          <span className="ml-1.5 rounded-full bg-white/60 px-1.5 py-px font-mono text-[10px] font-semibold">{r.kindLabel}</span>
                        </span>
                        <span className="font-mono font-semibold">{r.remaining} pcs</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Kalau tidak ada FG/Reject/Rework tersisa sama sekali untuk MRP ini (semua sudah
                masuk koli), jangan render baris item — dulu selalu ada minimal 1 baris "hantu"
                dari defaultItemForMrp's fallback kosong (warna/size kosong) walau pesan
                "Tidak ada hasil produksi tersedia" di atas sudah bilang tidak ada apa2 lagi. */}
            {anyAvailable && items.map((it, idx) => {
              const warnaOpts = warnaOptionsFor(it.kind);
              const lenganOpts = it.warna ? lenganOptionsFor(it.warna, it.kind) : [];
              const sizeOpts = it.warna ? sizeOptionsFor(idx, it.warna, it.lengan, it.kind) : [];
              const usiaOpts = it.warna && it.size ? usiaOptionsFor(it.warna, it.lengan, it.size, it.kind) : [];
              const max = it.warna && it.size ? remainingFor(idx, it.kind, it.warna, it.lengan, it.size, it.usia) : 0;
              return (
                <div key={idx} className="mt-2 grid grid-cols-7 items-end gap-2 rounded-md border border-border-subtle bg-white p-2.5">
                  <div>
                    <div className="font-sans text-[10px] text-text-muted">Jenis produk</div>
                    <select value={it.kind} onChange={(e) => updateItem(idx, { kind: e.target.value as ShippableKind })} className="input mt-0.5">
                      {PRODUCT_KIND_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-text-muted">Warna</div>
                    <select value={it.warna} onChange={(e) => updateItem(idx, { warna: e.target.value })} className="input mt-0.5">
                      {warnaOpts.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-text-muted">Lengan</div>
                    <select value={it.lengan} onChange={(e) => updateItem(idx, { lengan: e.target.value as Lengan })} className="input mt-0.5">
                      {lenganOpts.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-text-muted">Size</div>
                    <select value={it.size} onChange={(e) => updateItem(idx, { size: e.target.value })} className="input mt-0.5">
                      {sizeOpts.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="font-sans text-[10px] text-text-muted">Kids/Dewasa</div>
                    <select
                      value={it.usia ?? ""}
                      onChange={(e) => updateItemUsia(idx, e.target.value === "" ? undefined : (e.target.value as Usia))}
                      disabled={usiaOpts.length <= 1}
                      className="input mt-0.5 disabled:bg-[#F7F9FB] disabled:text-text-muted"
                    >
                      {usiaOpts.map((u) => (
                        <option key={u ?? "-"} value={u ?? ""}>
                          {u ? USIA_LABEL[u] : "-"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    {/* "Sisa bisa dikirim" = qty hasil produksi DIKURANGI yang sudah dipacking di koli
                        lain & yang sudah dialokasikan ke baris lain di form ini — BUKAN total qty hasil
                        produksi mentah. Ditulis eksplisit begini (bukan cuma "maks N") supaya jelas kenapa
                        angkanya bisa 0 walau size itu masih muncul di dropdown (berarti sudah habis
                        dialokasikan, bukan belum pernah diproduksi). */}
                    <div className="font-sans text-[10px] text-text-muted">Qty — sisa bisa dikirim: {max} pcs</div>
                    <NumberInput value={it.qty} decimals={0} onChange={(v) => updateItem(idx, { qty: Math.max(0, Math.min(v, max)) })} className="input mt-0.5" />
                    {max === 0 && it.size && (
                      <div className="mt-1 font-sans text-[10px] text-warning-fg">Sudah habis dipacking/dialokasikan — pilih ukuran lain.</div>
                    )}
                  </div>
                  <Button onClick={() => removeItem(idx)} variant="danger" size="xs">
                    Hapus
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3">
          <button onClick={submit} className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white">
            {editingKoliId ? "Update koli" : "Simpan koli"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Koli belum dikirim</div>
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div
              className="grid gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted"
              style={{ gridTemplateColumns: "80px 100px 130px 1fr 100px 110px 60px 80px" }}
            >
              <span>No MRP</span>
              <span>No Koli</span>
              <span>Ekspedisi</span>
              <span>Isi</span>
              <span className="text-right">Berat koli (kg)</span>
              <span className="text-right">Estimasi ongkir</span>
              <span />
              <span />
            </div>
            {pending.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Tidak ada koli menunggu pengiriman.</div>}
            {pending.map((k) => {
              const berat = weightDraft[k.id] ?? 0;
              const ongkir = k.ekspedisi && berat > 0 ? ekspedisiPrice(k.ekspedisi, berat) : null;
              const isExpanded = expandedKoli.has(k.id);
              return (
                <Fragment key={k.id}>
                  <div
                    className="grid items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0"
                    style={{ gridTemplateColumns: "80px 100px 130px 1fr 100px 110px 60px 80px" }}
                  >
                    <span className="font-mono">{k.mrpId}</span>
                    <span className="font-mono font-medium">{k.noKoli}</span>
                    <select value={k.ekspedisi} onChange={(e) => setKoliEkspedisi(k.id, e.target.value)} className="input text-[11.5px]">
                      <option value="">— pilih ekspedisi —</option>
                      {EKSPEDISI_LIST.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => toggleKoliExpanded(k.id)}
                      className="flex items-center gap-1 text-left font-sans text-xs text-[#31414F] hover:text-action-primary"
                      title="Klik untuk lihat rincian isi koli per item"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                      )}
                      {summarizeItems(k.items)}
                    </button>
                    <span className="flex justify-end">
                      <NumberInput value={berat} decimals={2} onChange={(v) => setWeightDraft((prev) => ({ ...prev, [k.id]: v }))} className="input w-[100px] text-right" />
                    </span>
                    <span className="text-right font-mono text-[11px] text-text-muted">{ongkir != null ? formatRupiah(ongkir) : "—"}</span>
                    <span className="text-right">
                      <Button onClick={() => editKoli(k)} variant="ghost" size="xs">
                        Edit
                      </Button>
                    </span>
                    <span className="text-right">
                      <Button
                        onClick={() => doDelivery(k.id)}
                        disabled={!(berat > 0 && k.ekspedisi)}
                        title={!k.ekspedisi ? "Pilih ekspedisi dulu" : undefined}
                        variant="success"
                        size="xs"
                      >
                        Delivery →
                      </Button>
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-4 py-3 last:border-b-0">
                      <ItemsDetailPanel items={k.items} />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-4 py-3 font-sans text-[13px] font-semibold text-text-primary">Riwayat pengiriman</div>
        <div className="grid grid-cols-6 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
          <span>No MRP</span>
          <span>No Koli</span>
          <span>Ekspedisi</span>
          <span className="text-right">Berat (kg)</span>
          <span>Tanggal delivery</span>
          <span>Isi</span>
        </div>
        {delivered.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada koli terkirim.</div>}
        {delivered.map((k) => {
          const isExpanded = expandedKoli.has(k.id);
          return (
            <Fragment key={k.id}>
              <div className="grid grid-cols-6 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                <span className="font-mono">{k.mrpId}</span>
                <span className="font-mono font-medium">{k.noKoli}</span>
                <span>{k.ekspedisi}</span>
                <span className="text-right font-mono">{formatDecimal(k.beratKoli ?? 0)}</span>
                <span className="font-mono text-[11px] text-text-muted">{formatDate(k.deliveredAt)}</span>
                <button
                  onClick={() => toggleKoliExpanded(k.id)}
                  className="flex items-center gap-1 text-left font-sans text-xs text-[#31414F] hover:text-action-primary"
                  title="Klik untuk lihat rincian isi koli per item"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 flex-none text-text-muted" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 flex-none text-text-muted" />
                  )}
                  {summarizeItems(k.items)}
                </button>
              </div>
              {isExpanded && (
                <div className="border-b border-[#F1F4F7] bg-[#FAFBFC] px-4 py-3 last:border-b-0">
                  <ItemsDetailPanel items={k.items} />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </AppShell>
  );
}

export default function VendorPengirimanPage() {
  return <VendorAuthGuard>{(vendorId) => <PengirimanContent vendorId={vendorId} />}</VendorAuthGuard>;
}
