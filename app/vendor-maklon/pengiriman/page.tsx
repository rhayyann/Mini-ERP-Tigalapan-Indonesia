"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { NumberInput } from "@/components/mrp/number-input";
import { Button } from "@/components/ui/button";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { useMrpStore } from "@/lib/mrp/store";
import { usePendingActions } from "@/lib/mrp/usePendingActions";
import { getDeliveryKoliEkspedisiPhotoAction } from "@/lib/mrp/actions";
import { openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";
import { availableFgToShip, ekspedisiPrice, formatDate, formatDecimal, formatRupiah, mrpIdsWithClosedRolls, mrpIdsWithUnpackedFg, rollRemainingBySizeForMrp } from "@/lib/mrp/derive";
import { countPengirimanPendingForMrp, pendingMarker } from "@/lib/shell/badges";
import { EKSPEDISI_LIST, VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { AvailableFgRow } from "@/lib/mrp/derive";
import type { DeliveryKoliItem, Lengan, ShippableKind, Usia } from "@/lib/mrp/types";

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

/** Kunci 1 baris "Isi qty per size (Finish Good)" -- warna·lengan·size, dipakai jadi index draft
 *  qty roll DAN untuk mengagregasi `RollRemainingRow[]` (per roll) jadi 1 baris per size (roll bisa
 *  banyak untuk warna·lengan yang sama). Beda dari `rowKey` di atas (yang juga menyertakan
 *  kind/usia) karena roll FG di sini selalu kind FG & tidak berusia. */
function rollSizeKey(warna: string, lengan: Lengan, size: string): string {
  return [warna, lengan, size].join("|");
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

/** Item 2026-09-10 (migration 0024): kompres foto lampiran ekspedisi di BROWSER sebelum dikirim ke
 *  Server Action, pola SAMA PERSIS `compressImageToDataUrl` di production-cutting-tab.tsx (klaim
 *  fisik) -- resize ke sisi terpanjang maks 1280px, JPEG quality 0.7, disimpan sebagai data-URI. */
async function compressImageToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file foto."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Gagal membaca gambar."));
    el.src = raw;
  });
  const MAX_EDGE = 1280;
  let { width, height } = img;
  if (width > MAX_EDGE || height > MAX_EDGE) {
    if (width >= height) {
      height = Math.round((height / width) * MAX_EDGE);
      width = MAX_EDGE;
    } else {
      width = Math.round((width / height) * MAX_EDGE);
      height = MAX_EDGE;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung kompresi foto (canvas).");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

const MAX_EKSPEDISI_PHOTO_BYTES = 700 * 1024;

function dataUrlApproxBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.round(b64.length * 0.75);
}

async function viewEkspedisiPhoto(koliId: string) {
  const win = openPreviewWindow();
  try {
    const photo = await getDeliveryKoliEkspedisiPhotoAction(koliId);
    if (!photo) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, photo.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

function PengirimanContent({ vendorId }: { vendorId: string }) {
  const productionResults = useMrpStore((s) => s.productionResults);
  const productionBatches = useMrpStore((s) => s.productionBatches);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const productionGroupMeta = useMrpStore((s) => s.productionGroupMeta);
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  const createDeliveryKoli = useMrpStore((s) => s.createDeliveryKoli);
  const updateDeliveryKoli = useMrpStore((s) => s.updateDeliveryKoli);
  const setKoliWeight = useMrpStore((s) => s.setKoliWeight);
  const markKoliDelivered = useMrpStore((s) => s.markKoliDelivered);
  const setKoliEkspedisi = useMrpStore((s) => s.setKoliEkspedisi);

  // BUG FIX (2026-09-09): union dengan mrpIdsWithClosedRolls -- lihat catatan panjang di
  // definisinya (lib/mrp/derive.ts). Tanpa ini, MRP yang FG-nya semua lewat jalur "Tutup Roll"
  // (paling umum sekarang) tidak akan pernah muncul di dropdown ini sama sekali.
  const mrpIds = Array.from(
    new Set([...mrpIdsWithUnpackedFg(vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs), ...mrpIdsWithClosedRolls(vendorId, productionBatches, deliveryKolis, maklonPOs, productionGroupMeta)])
  );

  const [mrpId, setMrpId] = useState("");
  const [noKoli, setNoKoli] = useState("");
  // Qty per baris "Isi koli" (Rework & sisa FG lama sebelum fitur roll), keyed by
  // rowKey(kind, warna|lengan|size|usia) — lihat rowKey().
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [weightDraft, setWeightDraft] = useState<Record<string, number>>({});
  const [editingKoliId, setEditingKoliId] = useState<string | null>(null);
  // Item 2026-09-10 (migration 0024, "roll boleh dikirim sebagian"): qty per baris "Isi qty per
  // size (Finish Good)", keyed by rollSizeKey(warna,lengan,size) -- pola SAMA PERSIS "Isi qty per
  // size" di Finish Good (production-result-panel.tsx, item 15): user ketik TOTAL qty per size,
  // submit mendistribusikannya ke roll manapun yang cocok (roll pertama dulu, isi sisa
  // kapasitasnya) jadi DeliveryKoliItem[] ber-`sourceBatchId` -- lihat buildRollItems().
  const [rollQtyDraft, setRollQtyDraft] = useState<Record<string, number>>({});
  // Klik baris "Koli belum dikirim"/"Riwayat pengiriman" untuk expand/collapse rincian isi koli
  // per item — id koli unik lintas kedua tabel jadi aman pakai 1 Set gabungan.
  const [expandedKoli, setExpandedKoli] = useState<Set<string>>(new Set());
  // Item revisi 2026-09-07 (owner: aksi vendor produksi terasa lambat -- tidak ada tanda loading
  // sama sekali sebelum ini): dipakai tombol "Delivery →" di bawah, per koli (banyak koli
  // independen di daftar yang sama, tidak boleh saling mengunci).
  const { isPending, run: runPendingAction } = usePendingActions();

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
      setRollQtyDraft({});
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

  // Item 2026-09-10 (migration 0024) -- sisa qty FG PER SIZE dari roll (ProductionBatch) yang
  // sudah "Tutup Roll" & masih ada sisa untuk MRP ini (`editingKoliId` diteruskan supaya qty yang
  // SUDAH ada di koli yang sedang di-edit tetap terhitung "tersedia", bukan "sudah terpakai koli
  // lain" -- lihat rollRemainingBySizeForMrp).
  const rollRows = mrpId ? rollRemainingBySizeForMrp(mrpId, vendorId, productionBatches, deliveryKolis, maklonPOs, productionGroupMeta, editingKoliId ?? undefined) : [];
  const availableBySize = new Map<string, number>();
  for (const row of rollRows) {
    for (const [size, qty] of Object.entries(row.remaining)) {
      const key = rollSizeKey(row.roll.warna, row.roll.lengan, size);
      availableBySize.set(key, (availableBySize.get(key) ?? 0) + qty);
    }
  }
  const rollSizeRows = Array.from(availableBySize.entries())
    .map(([key, available]) => {
      const [warna, lengan, size] = key.split("|");
      return { key, warna, lengan: lengan as Lengan, size, available };
    })
    .sort((a, b) => (a.warna + a.lengan).localeCompare(b.warna + b.lengan) || a.size.localeCompare(b.size));

  function setRowQty(key: string, qty: number) {
    setQtyDraft((prev) => ({ ...prev, [key]: qty }));
  }

  function setRollQty(key: string, qty: number) {
    setRollQtyDraft((prev) => ({ ...prev, [key]: qty }));
  }

  function pickMrp(id: string) {
    setMrpId(id);
    setQtyDraft({});
    setRollQtyDraft({});
  }

  function editKoli(k: (typeof deliveryKolis)[number]) {
    setEditingKoliId(k.id);
    setMrpId(k.mrpId);
    setNoKoli(k.noKoli);
    setQtyDraft(Object.fromEntries(k.items.filter((it) => !it.sourceBatchId).map((it) => [rowKey(it.kind ?? "FG", it), it.qty])));
    // Qty roll yang SUDAH ada di koli ini (item ber-sourceBatchId), diagregasi kembali ke draft
    // per size supaya form "Isi qty per size" pre-filled dengan isi koli saat ini.
    const rollDraft: Record<string, number> = {};
    for (const it of k.items) {
      if (!it.sourceBatchId) continue;
      const key = rollSizeKey(it.warna, it.lengan, it.size);
      rollDraft[key] = (rollDraft[key] ?? 0) + it.qty;
    }
    setRollQtyDraft(rollDraft);
  }

  function cancelEdit() {
    setEditingKoliId(null);
    setMrpId("");
    setNoKoli("");
    setQtyDraft({});
    setRollQtyDraft({});
  }

  // Item 2026-09-10 (migration 0024): distribusikan TOTAL qty per size (rollQtyDraft) ke roll
  // manapun yang cocok -- roll PERTAMA dulu, isi sisa kapasitasnya, pola SAMA PERSIS
  // `saveSizeTotals` di production-result-panel.tsx (Finish Good, item 15). Tiap sub-hasil jadi 1
  // DeliveryKoliItem ber-`sourceBatchId` (bisa lebih dari 1 item per size kalau 1 size dipecah
  // lintas >1 roll) -- server (clampDeliveryItemsBySourceBatch, actions.ts) meng-clamp ULANG qty
  // ini ke snapshot fresh sebelum benar-benar disimpan, jadi hasil distribusi di sini murni
  // optimistik/UI, bukan satu-satunya pertahanan terhadap balapan.
  function buildRollItems(): DeliveryKoliItem[] {
    const items: DeliveryKoliItem[] = [];
    for (const [key, draftQtyRaw] of Object.entries(rollQtyDraft)) {
      const draftQty = Math.min(draftQtyRaw, availableBySize.get(key) ?? 0);
      if (draftQty <= 0) continue;
      const [warna, lengan, size] = key.split("|");
      let sisa = draftQty;
      for (const row of rollRows) {
        if (sisa <= 0) break;
        if (row.roll.warna !== warna || row.roll.lengan !== lengan) continue;
        const avail = row.remaining[size] ?? 0;
        if (avail <= 0) continue;
        const take = Math.min(sisa, avail);
        items.push({ warna, lengan: lengan as Lengan, size, qty: take, kind: "FG", sourceBatchId: row.roll.id });
        sisa -= take;
      }
    }
    return items;
  }

  // Item revisi 2026-09-07 (owner: aksi vendor produksi terasa lambat -- tidak ada tanda loading
  // sama sekali sebelum ini): dulu fungsi ini TIDAK async & TIDAK menunggu createDeliveryKoli/
  // updateDeliveryKoli sama sekali -- form langsung dikosongkan SEKETIKA meski createDeliveryKoli
  // (koli BARU, bukan optimistic -- lihat store.ts) belum tentu sudah selesai di server, jadi ada
  // jeda "form kosong tapi koli barunya belum kelihatan" sampai backgroundRefresh selesai, tanpa
  // ada tanda apa pun kalau masih diproses.
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    if (!mrpId || !noKoli.trim() || submitting) return;
    const validItems: DeliveryKoliItem[] = rows
      .filter((r) => (qtyDraft[r.key] ?? 0) > 0)
      .map((r) => ({ warna: r.warna, lengan: r.lengan, size: r.size, usia: r.usia, qty: Math.min(qtyDraft[r.key] ?? 0, r.available), kind: r.kind }));
    const rollItems = buildRollItems();
    const allItems = [...validItems, ...rollItems];
    if (allItems.length === 0) return;
    setSubmitting(true);
    try {
      if (editingKoliId) {
        const existing = deliveryKolis.find((k) => k.id === editingKoliId);
        await updateDeliveryKoli(editingKoliId, { ekspedisi: existing?.ekspedisi ?? "", noKoli: noKoli.trim(), items: allItems });
        cancelEdit();
      } else {
        // Ekspedisi belum dipilih di sini — dipilih belakangan langsung di tabel "Koli belum dikirim".
        await createDeliveryKoli({ mrpId, vendorProduksi: vendorId, ekspedisi: "", noKoli: noKoli.trim(), items: allItems });
        setNoKoli("");
        setQtyDraft({});
        setRollQtyDraft({});
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Item 2026-09-10 (migration 0024, feedback: "Saat pilih ekspedisi juga nanti akan ada input
  // gambar lampiran (note dari ekspedisi) sebelum melakukan proses penerbitan invoice & payment"):
  // pemilihan ekspedisi lewat `<select>` polos DIGANTI dialog kecil (pola sama dialog klaim fisik
  // di production-cutting-tab.tsx) -- ekspedisi + catatan (wajib) + foto (wajib) disubmit SEKALIGUS
  // lewat setKoliEkspedisiAction, satu aksi atomik.
  const [ekspedisiDialogKoliId, setEkspedisiDialogKoliId] = useState<string | null>(null);
  const [ekspedisiDraft, setEkspedisiDraft] = useState("");
  const [ekspedisiNoteDraft, setEkspedisiNoteDraft] = useState("");
  const [ekspedisiPhotoDataUrl, setEkspedisiPhotoDataUrl] = useState<string | null>(null);
  const [ekspedisiPhotoFileName, setEkspedisiPhotoFileName] = useState<string | undefined>(undefined);
  const [ekspedisiPhotoError, setEkspedisiPhotoError] = useState<string | null>(null);
  const [ekspedisiPhotoBusy, setEkspedisiPhotoBusy] = useState(false);
  const [ekspedisiSubmitting, setEkspedisiSubmitting] = useState(false);
  const [ekspedisiError, setEkspedisiError] = useState<string | null>(null);
  const ekspedisiPhotoInputRef = useRef<HTMLInputElement>(null);

  function openEkspedisiDialog(k: (typeof deliveryKolis)[number]) {
    setEkspedisiDialogKoliId(k.id);
    setEkspedisiDraft(k.ekspedisi || "");
    setEkspedisiNoteDraft(k.ekspedisiNote ?? "");
    setEkspedisiPhotoDataUrl(null);
    setEkspedisiPhotoFileName(undefined);
    setEkspedisiPhotoError(null);
    setEkspedisiError(null);
  }
  function closeEkspedisiDialog() {
    setEkspedisiDialogKoliId(null);
    setEkspedisiDraft("");
    setEkspedisiNoteDraft("");
    setEkspedisiPhotoDataUrl(null);
    setEkspedisiPhotoFileName(undefined);
    setEkspedisiPhotoError(null);
    setEkspedisiError(null);
    if (ekspedisiPhotoInputRef.current) ekspedisiPhotoInputRef.current.value = "";
  }
  async function onEkspedisiPhotoSelected(file: File) {
    setEkspedisiPhotoError(null);
    setEkspedisiPhotoBusy(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      if (dataUrlApproxBytes(compressed) > MAX_EKSPEDISI_PHOTO_BYTES) {
        setEkspedisiPhotoError("Foto terlalu besar, ambil ulang dengan resolusi lebih kecil");
        setEkspedisiPhotoDataUrl(null);
        return;
      }
      setEkspedisiPhotoDataUrl(compressed);
      setEkspedisiPhotoFileName(file.name);
    } catch (e) {
      setEkspedisiPhotoError(e instanceof Error ? e.message : "Gagal memproses foto.");
    } finally {
      setEkspedisiPhotoBusy(false);
    }
  }
  async function submitEkspedisi() {
    if (!ekspedisiDialogKoliId || !ekspedisiDraft || !ekspedisiNoteDraft.trim() || !ekspedisiPhotoDataUrl || ekspedisiSubmitting) return;
    setEkspedisiSubmitting(true);
    setEkspedisiError(null);
    try {
      await setKoliEkspedisi(ekspedisiDialogKoliId, ekspedisiDraft, ekspedisiNoteDraft.trim(), { dataUrl: ekspedisiPhotoDataUrl, fileName: ekspedisiPhotoFileName });
      closeEkspedisiDialog();
    } catch (e) {
      setEkspedisiError(e instanceof Error ? e.message : "Gagal menyimpan ekspedisi.");
    } finally {
      setEkspedisiSubmitting(false);
    }
  }

  const myKolis = deliveryKolis.filter((k) => k.vendorProduksi === vendorId);
  const pending = myKolis.filter((k) => !k.deliveredAt);
  const delivered = myKolis.filter((k) => k.deliveredAt);

  function doDelivery(koliId: string) {
    const weight = weightDraft[koliId];
    const k = deliveryKolis.find((d) => d.id === koliId);
    if (!weight || weight <= 0 || !k?.ekspedisi || isPending(koliId)) return;
    // Bug fix sekalian (ketemu waktu menambah loading state): dulu setKoliWeight & markKoliDelivered
    // dipanggil TANPA await, bisa balapan -- markKoliDelivered (yang DIAM-DIAM no-op kalau berat_koli
    // belum tersimpan di server, lihat catatan di store.ts) berpotensi sampai ke server LEBIH DULU
    // dari setKoliWeight, membuat "Delivery" gagal diam-diam tanpa error sama sekali. Sekarang
    // di-await berurutan.
    runPendingAction(
      koliId,
      (async () => {
        await setKoliWeight(koliId, weight);
        await markKoliDelivered(koliId);
      })()
    );
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
                  {pendingMarker(countPengirimanPendingForMrp(id, vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs), "pcs belum dikemas")}
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
            {/* Item 2026-09-10 (migration 0024, feedback: "Saya ingin bisa input per size untuk
                qty tapi ... qty di roll yang telah ditentukan akan berkurang, sama seperti input
                finish good saat ini"): checkbox pilih ROLL UTUH DIHAPUS -- diganti input per size
                (pola sama Finish Good, item 15). Qty yang diketik mengurangi sisa roll manapun
                yang cocok -- 1 roll SEKARANG BOLEH dikirim sebagian (sisanya tetap tersedia untuk
                koli lain nanti), dikonfirmasi lewat AskUserQuestion. */}
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Isi qty per size (Finish Good) — qty mengurangi sisa roll yang cocok, roll boleh dikirim sebagian
            </div>
            {rollSizeRows.length === 0 && (
              <div className="mt-2 font-sans text-xs text-text-muted">Belum ada roll yang &quot;Tutup Roll&quot;-nya selesai (dengan sisa) untuk MRP ini (tab Finish Good).</div>
            )}
            {rollSizeRows.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-md border border-border-subtle bg-white">
                <div className="grid grid-cols-4 gap-x-2 border-b border-[#F1F4F7] bg-[#F7F9FB] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna / lengan</span>
                  <span>Size</span>
                  <span className="text-right">Sisa bisa dikirim</span>
                  <span className="text-right">Qty</span>
                </div>
                {rollSizeRows.map((r) => (
                  <div key={r.key} className="grid grid-cols-4 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1.5 font-sans text-xs text-[#31414F] last:border-b-0">
                    <span>
                      {r.warna} · {r.lengan}
                    </span>
                    <span>{r.size}</span>
                    <span className="text-right font-mono text-text-muted">{r.available} pcs</span>
                    <span className="flex justify-end">
                      <NumberInput
                        value={rollQtyDraft[r.key] ?? 0}
                        decimals={0}
                        onChange={(v) => setRollQty(r.key, Math.max(0, Math.min(v, r.available)))}
                        className="input w-[90px] text-right"
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {rollRows.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-md border border-[#F1F4F7] bg-[#FAFBFC]">
                <div className="grid grid-cols-4 gap-x-2 border-b border-[#F1F4F7] px-3 py-1 font-sans text-[9.5px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Roll</span>
                  <span>Warna / lengan</span>
                  <span>Sisa per size</span>
                  <span className="text-right">Sisa total</span>
                </div>
                {rollRows.map((row) => {
                  const sizeSummary = Object.entries(row.remaining)
                    .map(([size, q]) => `${size} ${q}`)
                    .join(", ");
                  const remainingTotal = Object.values(row.remaining).reduce((a, b) => a + b, 0);
                  return (
                    <div key={row.roll.id} className="grid grid-cols-4 items-center gap-x-2 border-b border-[#F1F4F7] px-3 py-1 font-sans text-[10.5px] text-text-muted last:border-b-0">
                      <span className="font-mono">{row.roll.codeRoll || row.roll.id}</span>
                      <span>
                        {row.roll.warna} · {row.roll.lengan}
                      </span>
                      <span className="font-mono">{sizeSummary || "—"}</span>
                      <span className="text-right font-mono">{remainingTotal} pcs</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mrpId && (
          <div className="mt-4">
            <div className="font-sans text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Isi koli (Rework &amp; sisa FG lama) — pilih apa yang mau dimasukkan, isi qty-nya (sisanya biarkan 0)
            </div>
            {!anyAvailable && <div className="mt-2 font-sans text-xs text-text-muted">Tidak ada Rework/sisa FG lama tersedia untuk MRP ini.</div>}
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
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-md bg-action-primary px-3.5 py-2 font-sans text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Menyimpan…" : editingKoliId ? "Update koli" : "Simpan koli"}
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
                    <span>
                      {k.ekspedisi ? (
                        <button onClick={() => openEkspedisiDialog(k)} className="text-left font-sans text-[11.5px] text-[#31414F] underline decoration-dotted hover:text-action-primary">
                          {k.ekspedisi}
                        </button>
                      ) : (
                        <button onClick={() => openEkspedisiDialog(k)} className="rounded-md border border-[#CBD5DF] bg-white px-2 py-1 font-sans text-[10.5px] font-medium text-action-primary">
                          Pilih ekspedisi
                        </button>
                      )}
                    </span>
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
                        disabled={!(berat > 0 && k.ekspedisi) || isPending(k.id)}
                        title={!k.ekspedisi ? "Pilih ekspedisi dulu" : undefined}
                        variant="success"
                        size="xs"
                      >
                        {isPending(k.id) ? "Mengirim…" : "Delivery →"}
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
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <div className="grid grid-cols-8 gap-x-2 border-b border-border-subtle bg-[#F7F9FB] px-4 py-[9px] font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">
              <span>No MRP</span>
              <span>No Koli</span>
              <span>Ekspedisi</span>
              <span className="text-right">Berat (kg)</span>
              <span className="text-right">Ongkir</span>
              <span>Tanggal delivery</span>
              <span>Catatan ekspedisi</span>
              <span>Isi</span>
            </div>
            {delivered.length === 0 && <div className="px-4 py-6 text-center font-sans text-xs text-text-muted">Belum ada koli terkirim.</div>}
            {delivered.map((k) => {
              const isExpanded = expandedKoli.has(k.id);
              // Revisi 2026-09-10 (migration 0024): field manual "Ongkir batch ini" DIHAPUS --
              // ongkir sekarang SELALU otomatis dari tarif ekspedisi × berat koli (formula SAMA
              // dengan "Estimasi ongkir" di tabel "Koli belum dikirim" di atas), tidak ada lagi
              // override manual/label "(manual)".
              const ongkir = k.ekspedisi && (k.beratKoli ?? 0) > 0 ? ekspedisiPrice(k.ekspedisi, k.beratKoli ?? 0) : null;
              return (
                <Fragment key={k.id}>
                  <div className="grid grid-cols-8 items-center gap-x-2 border-b border-[#F1F4F7] px-4 py-[11px] font-sans text-xs text-[#31414F] last:border-b-0">
                    <span className="font-mono">{k.mrpId}</span>
                    <span className="font-mono font-medium">{k.noKoli}</span>
                    <span>{k.ekspedisi}</span>
                    <span className="text-right font-mono">{formatDecimal(k.beratKoli ?? 0)}</span>
                    <span className="text-right font-mono text-[11px]">{ongkir != null ? formatRupiah(ongkir) : "—"}</span>
                    <span className="font-mono text-[11px] text-text-muted">{formatDate(k.deliveredAt)}</span>
                    <span className="min-w-0">
                      {k.ekspedisiNoteAt ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate text-[11px] text-[#31414F]" title={k.ekspedisiNote}>
                            {k.ekspedisiNote}
                          </span>
                          <button onClick={() => viewEkspedisiPhoto(k.id)} className="text-left font-sans text-[10.5px] font-semibold text-action-primary underline">
                            Lihat / Download foto
                          </button>
                        </div>
                      ) : (
                        <span className="font-sans text-[11px] text-text-muted">—</span>
                      )}
                    </span>
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
        </div>
      </div>

      {/* Item 2026-09-10 (migration 0024): dialog pilih ekspedisi -- catatan + foto lampiran
         WAJIB diisi bareng ekspedisi, satu aksi atomik (setKoliEkspedisiAction). Pola dialog SAMA
         PERSIS dialog klaim fisik di production-cutting-tab.tsx. */}
      {ekspedisiDialogKoliId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B131B]/45 p-4">
          <div className="w-full max-w-[480px] rounded-lg bg-white shadow-[0_8px_24px_rgba(11,19,27,.2)]">
            <div className="border-b border-border-subtle px-5 py-3.5">
              <span className="font-sans text-[13px] font-semibold text-text-primary">Pilih ekspedisi</span>
            </div>
            <div className="px-5 py-4">
              <div className="font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Ekspedisi</div>
              <select value={ekspedisiDraft} onChange={(e) => setEkspedisiDraft(e.target.value)} className="input mt-1 w-full">
                <option value="">— pilih ekspedisi —</option>
                {EKSPEDISI_LIST.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Catatan ekspedisi (wajib)</div>
              <textarea
                value={ekspedisiNoteDraft}
                onChange={(e) => setEkspedisiNoteDraft(e.target.value)}
                placeholder="Contoh: no resi, estimasi tiba, kontak ekspedisi..."
                rows={3}
                className="input mt-1 w-full"
              />
              <div className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-wider text-text-muted">Foto lampiran (wajib)</div>
              <input
                ref={ekspedisiPhotoInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onEkspedisiPhotoSelected(file);
                }}
                className="mt-1 font-sans text-[11px]"
              />
              {ekspedisiPhotoBusy && <div className="mt-1.5 font-sans text-[10.5px] text-text-muted">Memproses foto…</div>}
              {ekspedisiPhotoError && <div className="mt-1.5 font-sans text-[10.5px] text-danger-fg">{ekspedisiPhotoError}</div>}
              {ekspedisiPhotoDataUrl && !ekspedisiPhotoBusy && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ekspedisiPhotoDataUrl} alt="Preview foto lampiran ekspedisi" className="mt-2 max-h-[160px] rounded-md border border-[#EEF1F4]" />
              )}
              {ekspedisiError && <div className="mt-2 font-sans text-[10.5px] text-danger-fg">{ekspedisiError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
              <button onClick={closeEkspedisiDialog} className="rounded-md border border-[#CBD5DF] bg-white px-3.5 py-[7px] font-sans text-xs font-semibold text-action-primary">
                Batal
              </button>
              <Button
                onClick={submitEkspedisi}
                disabled={!ekspedisiDraft || !ekspedisiNoteDraft.trim() || !ekspedisiPhotoDataUrl || ekspedisiSubmitting}
                variant="accent"
                size="sm"
              >
                {ekspedisiSubmitting ? "Menyimpan…" : "Simpan ekspedisi"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function VendorPengirimanPage() {
  return <VendorAuthGuard>{(vendorId) => <PengirimanContent vendorId={vendorId} />}</VendorAuthGuard>;
}
