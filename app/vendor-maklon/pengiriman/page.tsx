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
import type { AvailableFgRow } from "@/lib/mrp/derive";
import type { DeliveryKoliItem, ShippableKind, Usia } from "@/lib/mrp/types";

const USIA_LABEL: Record<Usia, string> = { KIDS: "Kids", DEWASA: "Dewasa" };

// Item 20 (feedback batch 2026-09-04): Reject bukan lagi barang yang bisa DITAMBAHKAN ke koli baru
// -- dihapus dari opsi ini supaya tidak ada baris Reject baru yang bisa dibuat. `kindLabel` di
// bawah TETAP tahu label "Reject" supaya koli LAMA yang sudah terlanjur berisi baris Reject (dari
// sebelum perubahan ini) masih bisa dirender wajar (lihat `DeliveryItemKind`).
const PRODUCT_KIND_OPTIONS: { value: ShippableKind; label: string }[] = [
  { value: "FG", label: "Finish Good" },
  { value: "REWORK", label: "Rework" },
];

const LEGACY_KIND_LABELS: Record<string, string> = { REJECT: "Reject" };

function kindLabel(kind: DeliveryKoliItem["kind"]): string {
  return PRODUCT_KIND_OPTIONS.find((opt) => opt.value === kind)?.label ?? LEGACY_KIND_LABELS[kind] ?? kind;
}

/** Kunci unik 1 baris "Isi koli" — kombinasi jenis produk + warna + lengan + size + usia. Dulu
 *  tiap baris draft ("+ Tambah item") bisa menunjuk kombinasi APA SAJA lewat dropdown, jadi butuh
 *  logic rumit buat saling mengecualikan qty antar baris. Sekarang 1 kombinasi = 1 baris tetap
 *  (langsung dari hasil produksi yang tersedia), jadi kuncinya juga jadi index draft qty-nya. */
function rowKey(kind: DeliveryKoliItem["kind"], r: Pick<AvailableFgRow, "warna" | "lengan" | "size" | "usia">): string {
  return [kind, r.warna, r.lengan, r.size, r.usia ?? ""].join("|");
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
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const createDeliveryKoli = useMrpStore((s) => s.createDeliveryKoli);
  const updateDeliveryKoli = useMrpStore((s) => s.updateDeliveryKoli);
  const setKoliWeight = useMrpStore((s) => s.setKoliWeight);
  const markKoliDelivered = useMrpStore((s) => s.markKoliDelivered);

  const mrpIds = mrpIdsWithUnpackedFg(vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs);

  const [mrpId, setMrpId] = useState("");
  const [noKoli, setNoKoli] = useState("");
  // Qty per baris "Isi koli", keyed by rowKey(kind, warna|lengan|size|usia) — lihat rowKey().
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
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

  // MRP yang lagi dipilih di form ini bisa "habis" (semua FG/Rework sudah masuk koli)
  // begitu koli TERAKHIR untuk MRP itu disimpan — begitu itu terjadi, MRP-nya hilang dari
  // `mrpIds` (lihat mrpIdsWithUnpackedFg), tapi state `mrpId` di form ini TIDAK ikut ter-reset
  // sendiri. Akibatnya dropdown <select> tampil kosong (value-nya tidak cocok ke option manapun,
  // browser default balik ke placeholder), tapi bagian "Isi koli" di bawahnya tetap nyangkut ke
  // MRP lama yang sudah tidak relevan. Reset form-nya begitu ini kedeteksi (kecuali lagi edit
  // koli — biarkan edit tetap jalan meski MRP-nya sudah habis di form "buat baru").
  useEffect(() => {
    if (mrpId && !editingKoliId && !mrpIds.includes(mrpId)) {
      setMrpId("");
      setQtyDraft({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrpId, editingKoliId, mrpIds.join(",")]);

  function availableFor(kind: ShippableKind) {
    return mrpId ? availableFgToShip(mrpId, vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs, editingKoliId ?? undefined, kind) : [];
  }

  const availableByKind: Record<ShippableKind, ReturnType<typeof availableFgToShip>> = {
    FG: availableFor("FG"),
    REWORK: availableFor("REWORK"),
  };

  // Satu baris tetap per kombinasi jenis produk+warna+lengan+size+usia yang benar-benar tersedia
  // (bukan lagi baris draft bebas yang harus di-"+ Tambah item" dulu) — user tinggal isi qty
  // langsung di baris yang relevan, sisanya biarkan 0 (tidak ikut koli ini).
  const rows = PRODUCT_KIND_OPTIONS.flatMap((opt) => availableByKind[opt.value].map((r) => ({ ...r, kind: opt.value, key: rowKey(opt.value, r) })));
  const anyAvailable = rows.length > 0;

  function setRowQty(key: string, qty: number) {
    setQtyDraft((prev) => ({ ...prev, [key]: qty }));
  }

  function pickMrp(id: string) {
    setMrpId(id);
    setQtyDraft({});
  }

  function editKoli(k: (typeof deliveryKolis)[number]) {
    setEditingKoliId(k.id);
    setMrpId(k.mrpId);
    setNoKoli(k.noKoli);
    setQtyDraft(Object.fromEntries(k.items.map((it) => [rowKey(it.kind ?? "FG", it), it.qty])));
  }

  function cancelEdit() {
    setEditingKoliId(null);
    setMrpId("");
    setNoKoli("");
    setQtyDraft({});
  }

  function submit() {
    if (!mrpId || !noKoli.trim()) return;
    const validItems: DeliveryKoliItem[] = rows
      .filter((r) => (qtyDraft[r.key] ?? 0) > 0)
      .map((r) => ({ warna: r.warna, lengan: r.lengan, size: r.size, usia: r.usia, qty: Math.min(qtyDraft[r.key] ?? 0, r.available), kind: r.kind }));
    if (validItems.length === 0) return;
    if (editingKoliId) {
      const existing = deliveryKolis.find((k) => k.id === editingKoliId);
      updateDeliveryKoli(editingKoliId, { ekspedisi: existing?.ekspedisi ?? "", noKoli: noKoli.trim(), items: validItems });
      cancelEdit();
    } else {
      // Ekspedisi belum dipilih di sini — dipilih belakangan langsung di tabel "Koli belum dikirim".
      createDeliveryKoli({ mrpId, vendorProduksi: vendorId, ekspedisi: "", noKoli: noKoli.trim(), items: validItems });
      setNoKoli("");
      setQtyDraft({});
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
            {mrpIds.length === 0 && !editingKoliId && (
              <div className="mt-1 font-sans text-[11px] text-text-muted">
                Belum ada finish good yang siap dipacking. Warna/lengan baru muncul di sini setelah ditandai &quot;Selesai Produksi&quot; di tab Finish
                Good (tahap 1) — kecuali PO Produksinya sudah di-Close.
              </div>
            )}
          </div>
          <div>
            <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">No koli</div>
            <input value={noKoli} onChange={(e) => setNoKoli(e.target.value)} placeholder="Contoh: KOLI-001" className="input mt-1" />
          </div>
        </div>
        <div className="mt-2 font-sans text-[11px] text-text-muted">Ekspedisi dipilih belakangan di tabel &quot;Koli belum dikirim&quot; di bawah.</div>

        {mrpId && (
          <div className="mt-4">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Isi koli — pilih apa yang mau dimasukkan, isi qty-nya (sisanya biarkan 0)
            </div>
            {!anyAvailable && <div className="mt-2 font-sans text-xs text-text-muted">Tidak ada hasil produksi (FG/Rework) tersedia untuk MRP ini.</div>}
            {anyAvailable && (
              <div className="mt-2 overflow-hidden rounded-md border border-border-subtle bg-white">
                <div className="grid grid-cols-6 gap-x-2 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Jenis produk</span>
                  <span>Warna</span>
                  <span>Lengan</span>
                  <span>Size / Usia</span>
                  <span className="text-right">Sisa bisa dikirim</span>
                  <span className="text-right">Qty</span>
                </div>
                {rows.map((r) => {
                  const qty = qtyDraft[r.key] ?? 0;
                  return (
                    <div key={r.key} className="grid grid-cols-6 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                      <span>{kindLabel(r.kind)}</span>
                      <span>{r.warna}</span>
                      <span>{r.lengan}</span>
                      <span>
                        {r.size}
                        {r.usia ? " · " + USIA_LABEL[r.usia] : ""}
                      </span>
                      <span className="text-right font-mono text-text-muted">{r.available} pcs</span>
                      <span className="flex justify-end">
                        <NumberInput value={qty} decimals={0} onChange={(v) => setRowQty(r.key, Math.max(0, Math.min(v, r.available)))} className="input w-[90px] text-right" />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
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
