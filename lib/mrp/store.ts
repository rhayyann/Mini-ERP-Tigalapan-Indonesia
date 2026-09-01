import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ENTITAS_LIST, MATERIAL_RATE_PER_ROLL, SUPPLIERS, VENDOR_PRODUKSI } from "./seed";
import {
  cumulativeSizeQtyForGroup,
  localDateString,
  maklonAmountForLenganBuckets,
  maklonAmountForVendor,
  maklonPoInvoiceLockedBy,
  maklonProductionFullyDone,
  materialAmountForPo,
  materialClaimsList,
  targetSizesForGroup,
} from "./derive";
import type { ParsedMrpImport } from "./parseImport";
import type { EntitasRow, HargaKainPksRow, HargaKainRow, HargaMaklonRow, SupplierRow } from "./masterData";
import type { AddBuyItem, AduanPolaRow, ColorBreakdown, ColorEntry, DeliveryKoli, DeliveryKoliItem, Lengan, LenganGroup, MaklonInvoice, MaklonPO, MaterialPO, MaterialRow, Mrp, Notification, ProductionBatch, ProductionGroupMeta, ProductionResult, ProductionResultKind, RawMaterialInvoice, Usia, VendorInvoice, VendorInvoiceAdjustmentKind, VendorInvoiceLine } from "./types";

export type MrpDates = {
  created: string;
  ppicSubmitted?: string;
  ppicApproved?: string;
  poSent?: string;
  poApproved?: string;
  firstInvoice?: string;
  firstPayment?: string;
};

export type PpicApprovalStatus = "DRAFT" | "WAITING_PPIC_APPROVAL" | "PPIC_APPROVED" | "REJECTED";

export type MrpDetail = {
  mrp: Mrp;
  lenganGroups: LenganGroup[];
  aduanRows: AduanPolaRow[];
  materialRows: MaterialRow[];
  poSent: boolean;
  dates: MrpDates;
  ppicApproval: PpicApprovalStatus;
  /** Alasan penolakan SCM — cuma terisi kalau ppicApproval === "REJECTED" (lihat rejectPpicMrp).
   *  Tidak ada jalur edit/resubmit MRP setelah import, jadi ini murni catatan buat PPIC supaya
   *  tahu kenapa ditolak sebelum impor ulang. */
  ppicRejectionNote?: string;
};

type FlowState = {
  mrpDetails: MrpDetail[];
  staticMrps: Mrp[];
  materialPOs: MaterialPO[];
  maklonPOs: MaklonPO[];
  invoices: RawMaterialInvoice[];
  maklonInvoices: MaklonInvoice[];
  productionBatches: ProductionBatch[];
  productionResults: ProductionResult[];
  deliveryKolis: DeliveryKoli[];
  vendorInvoices: VendorInvoice[];
  notifications: Notification[];
  productionGroupMeta: ProductionGroupMeta[];
  rejectRemarks: Record<string, string>;
  // Tindak lanjut klaim selisih berat (lihat materialClaimsList di lib/mrp/derive.ts, yang
  // MENURUNKAN daftar klaim langsung dari invoices+rollReceipts — tidak butuh state list
  // tersendiri). Key = invoiceId+"|"+warna+"|"+lengan+"|"+rollIndex (sama seperti
  // MaterialClaimRow.key), value = catatan penyelesaian Procurement.
  materialClaimResolutions: Record<string, { note: string; resolvedAt: string }>;
  // Tahap "retur diminta ke supplier" — sebelum benar-benar selesai (roll pengganti sudah
  // ditimbang ulang vendor & hasilnya masuk toleransi, yang membuat baris itu otomatis hilang
  // dari materialClaimsList — TIDAK perlu ditandai manual "Selesai" lagi). Key sama persis
  // dengan materialClaimResolutions (MaterialClaimRow.key).
  materialClaimReturRequests: Record<string, { note: string; requestedAt: string }>;
  // Master Data (lihat lib/mrp/masterData.ts) — data referensi yang bisa diimpor dari Google
  // Sheets lalu dikelola (tambah/edit/hapus) di halaman Master Data masing-masing modul. Belum
  // dipakai otomatis oleh kalkulasi PO/invoice manapun di fase ini (lihat catatan di masterData.ts).
  hargaMaklon: HargaMaklonRow[];
  hargaKain: HargaKainRow[];
  hargaKainPks: HargaKainPksRow[];
  entitasList: EntitasRow[];
  supplierList: SupplierRow[];
};

type FlowActions = {
  importMrp: (parsed: ParsedMrpImport, customId?: string) => string;
  switchAduanVendor: (mrpId: string, aduanId: string, toVendor: string) => void;
  assignMaterialSupplier: (mrpId: string, materialRowId: string, supplier: string) => void;
  assignMaterialEntitas: (mrpId: string, materialRowId: string, entitas: string) => void;
  setMaterialPoEntity: (poId: string, entitas: string) => void;
  setMaterialPoColorEntity: (poId: string, warna: string, lengan: Lengan, entitas: string) => void;
  approvePpicMrp: (mrpId: string) => void;
  rejectPpicMrp: (mrpId: string, reason: string) => void;
  sendPoToFinance: (mrpId: string) => void;
  approveMaterialPo: (id: string) => void;
  approveAllMaterialPos: () => void;
  approveVendorMaterialPos: (mrpId: string, vendor: string) => void;
  approveMaklonPo: (id: string) => void;
  bookInvoice: (
    poId: string,
    input: { colorEntries: ColorEntry[]; addBuys: AddBuyItem[]; diskon: number; kodeTransaksi: string; noInvoiceVendor: string; buktiPvDataUrl?: string; buktiPvFileName?: string }
  ) => void;
  closePoWithReason: (poId: string, reason: string, warna: string, lengan: Lengan, closeQty: number) => void;
  // Beda dari closePoWithReason: dipakai kalau supplier lama ternyata TIDAK SANGGUP kirim warna
  // tertentu, tapi kebutuhan produksinya TETAP ADA — jadi cuma sumber materialnya yang dialihkan
  // ke supplier baru (PO Material baru dibuat), qty PO Vendor Produksi (maklon) TIDAK ikut
  // dipotong (beda dari closePoWithReason yang selalu memotong maklon karena dianggap
  // pembatalan permanen).
  reassignMaterialToSupplier: (poId: string, warna: string, lengan: Lengan, moveQty: number, newSupplier: string, reason: string) => void;
  setInvoicesDelivery: (invoiceIds: string[], deliveryDate: string) => void;
  setInvoicesPaid: (invoiceIds: string[], paid: boolean) => void;
  transferMaterial: (items: { invoiceId: string; qty: number }[], toVendor: string, deliveryDate: string) => void;
  advanceMaklonProduction: (id: string) => void;
  submitMaklonInvoice: (maklonPoId: string, input: { penalty: number; bonus: number; retentionPct: number; note: string }) => void;
  approveMaklonInvoice: (invoiceId: string) => void;
  payMaklonInvoice: (invoiceId: string) => void;
  receiveRawMaterialRoll: (
    invoiceId: string,
    warna: string,
    lengan: Lengan,
    rollIndex: number,
    netKg: number,
    codeRoll?: string,
    codeLot?: string,
    claim?: { diffKg: number; pct: number }
  ) => void;
  receiveRawMaterialAddBuy: (invoiceId: string, addBuyId: string) => void;
  startProductionBatch: (input: { mrpId: string; aduanRowId: string; qtyRoll: number; gramasi: number; restingAt: string; codeRoll?: string }) => void;
  updateBatchToCutting: (batchId: string, cuttingAt: string) => void;
  submitProductionResult: (input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; kind: ProductionResultKind; sizeQty: Record<string, number>; note?: string }) => void;
  reworkRejectSize: (input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; fromSize: string; qty: number; toLengan: Lengan; toSize: string; usia: Usia }) => void;
  createDeliveryKoli: (input: { mrpId: string; vendorProduksi: string; ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }) => void;
  updateDeliveryKoli: (koliId: string, patch: { ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }) => void;
  setKoliWeight: (koliId: string, beratKoli: number) => void;
  markKoliDelivered: (koliId: string) => void;
  createVendorInvoice: (input: {
    vendorProduksi: string;
    lines: { mrpId: string; warna: string; lengan: Lengan; usia?: Usia; qty: number; ratePerPc: number }[];
    note?: string;
  }) => void;
  setVendorInvoiceStatus: (invoiceId: string, status: VendorInvoice["status"]) => void;
  addVendorInvoiceAdjustment: (invoiceId: string, input: { kind: VendorInvoiceAdjustmentKind; label: string; amount: number; note?: string }) => void;
  setVendorInvoiceDueDate: (invoiceId: string, dueDate: string) => void;
  setVendorInvoiceOngkir: (invoiceId: string, ongkirTotal: number) => void;
  /** Bayar lunas sekaligus — retensi sudah dihapus dari alur (keputusan bisnis terbaru), jadi
   *  tidak ada lagi tahap/gembok delivery-100% seperti sebelumnya (lihat catatan di derive.ts). */
  payVendorInvoice: (invoiceId: string) => void;
  markProductionGroupDone: (groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan) => void;
  undoProductionGroupDone: (groupKey: string) => void;
  setRejectRemark: (poId: string, remark: string) => void;
  resolveMaterialClaim: (key: string, note: string) => void;
  unresolveMaterialClaim: (key: string) => void;
  requestMaterialClaimRetur: (key: string, note: string) => void;
  cancelMaterialClaimReturRequest: (key: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: (ids: string[]) => void;
  dismissNotification: (id: string) => void;
  resetAll: () => void;

  // Master Data CRUD — addX menambah 1 baris baru (kosong/default, id auto), updateX mengubah 1
  // baris by id, deleteX menghapus 1 baris by id, replaceX mengganti SELURUH tabel sekaligus
  // (dipakai tombol "Import dari Google Sheets" — full replace, bukan merge).
  addHargaMaklonRow: () => void;
  updateHargaMaklonRow: (id: string, patch: Partial<HargaMaklonRow>) => void;
  deleteHargaMaklonRow: (id: string) => void;
  replaceHargaMaklon: (rows: HargaMaklonRow[]) => void;
  addHargaKainRow: () => void;
  updateHargaKainRow: (id: string, patch: Partial<HargaKainRow>) => void;
  deleteHargaKainRow: (id: string) => void;
  replaceHargaKain: (rows: HargaKainRow[]) => void;
  addHargaKainPksRow: () => void;
  updateHargaKainPksRow: (id: string, patch: Partial<HargaKainPksRow>) => void;
  deleteHargaKainPksRow: (id: string) => void;
  replaceHargaKainPks: (rows: HargaKainPksRow[]) => void;
  addEntitas: (nama: string) => void;
  updateEntitas: (id: string, nama: string) => void;
  deleteEntitas: (id: string) => void;
  replaceEntitas: (rows: EntitasRow[]) => void;
  addSupplier: (nama: string) => void;
  updateSupplier: (id: string, nama: string) => void;
  deleteSupplier: (id: string) => void;
  replaceSupplier: (rows: SupplierRow[]) => void;
};

function today() {
  return localDateString(new Date());
}

/** Timestamp lengkap (tanggal + jam:menit, waktu lokal device) — dipakai buat recordedAt hasil
 *  produksi (Finish Good/Reject) supaya tracking progres per-hari BENAR-BENAR real-time (vendor
 *  minta bisa lihat "Senin jam sekian 60 pcs, Selasa jam sekian 60 pcs", bukan cuma tanggal).
 *  SELALU dari jam sistem saat submit — tidak ada input tanggal/jam manual di UI manapun, jadi
 *  tidak mungkin backdate. Format ISO-like (co: "2026-09-01 14:05") supaya tetap format-independent
 *  kalau nanti perlu di-parse ulang, dan tetap urut benar dipakai perbandingan string biasa. */
function nowIso() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${localDateString(d)} ${hh}:${mm}`;
}

const initialState: FlowState = {
  mrpDetails: [],
  staticMrps: [],
  materialPOs: [],
  maklonPOs: [],
  invoices: [],
  maklonInvoices: [],
  productionBatches: [],
  productionResults: [],
  deliveryKolis: [],
  vendorInvoices: [],
  notifications: [],
  productionGroupMeta: [],
  rejectRemarks: {},
  materialClaimResolutions: {},
  materialClaimReturRequests: {},
  hargaMaklon: [],
  hargaKain: [],
  hargaKainPks: [],
  // Sengaja MULAI KOSONG (bukan di-seed dari ENTITAS_LIST dummy) — supaya halaman Master Data >
  // Entitas bisa auto-import dari Google Sheets begitu terdeteksi kosong (lihat
  // ImportSheetButton's `autoImportIfEmpty` + normalizeState di bawah). Kalau ini di-seed dengan
  // data dummy, tabel tidak akan pernah "kosong" lagi setelahnya sehingga auto-import tidak
  // pernah kepicu — persis bug yang bikin user bingung ("kok masih data lama terus"). Fallback ke
  // ENTITAS_LIST[0] tetap ada di tempat lain (lihat `entitasFallback` di normalizeState) untuk
  // kondisi darurat sebelum sempat diimpor.
  entitasList: [],
  // Sama seperti entitasList — sengaja MULAI KOSONG (bukan di-seed dari SUPPLIERS dummy).
  // Dropdown "Vendor material" di PO Approval sumber utamanya sekarang dari nama supplier di tab
  // Harga Kain (lihat `materialSupplierNames` di lib/mrp/derive.ts) — daftar di sini murni
  // TAMBAHAN manual untuk supplier yang belum ada di Harga Kain, jadi tidak perlu data contoh
  // dummy dari awal lagi.
  supplierList: [],
};

let counter = 1;
function nextId(prefix: string) {
  return prefix + "-" + String(100 + counter++);
}

function bumpCounterPast(state: FlowState) {
  const allIds: string[] = [
    ...state.mrpDetails.map((d) => d.mrp.id),
    ...state.materialPOs.map((p) => p.id),
    ...state.maklonPOs.map((p) => p.id),
    ...state.invoices.map((i) => i.id),
    ...(state.maklonInvoices ?? []).map((i) => i.id),
    ...(state.productionBatches ?? []).map((b) => b.id),
    ...(state.productionResults ?? []).map((r) => r.id),
    ...(state.deliveryKolis ?? []).map((k) => k.id),
    ...(state.vendorInvoices ?? []).map((i) => i.id),
    ...(state.vendorInvoices ?? []).flatMap((i) => (i.adjustments ?? []).map((a) => a.id)),
    ...state.notifications.map((n) => n.id),
    ...(state.hargaMaklon ?? []).map((r) => r.id),
    ...(state.hargaKain ?? []).map((r) => r.id),
    ...(state.hargaKainPks ?? []).map((r) => r.id),
    ...(state.entitasList ?? []).map((r) => r.id),
    ...(state.supplierList ?? []).map((r) => r.id),
  ];
  let maxNumeric = 100;
  for (const id of allIds) {
    const match = id.match(/-(\d+)(?:-|$)/);
    if (match) maxNumeric = Math.max(maxNumeric, parseInt(match[1], 10));
  }
  counter = Math.max(counter, maxNumeric - 100 + 1);
}

/** True kalau entitasList persis sama dengan dummy placeholder lama (ENTITAS_LIST di seed.ts) —
 *  dipakai normalizeState untuk membedakan "belum pernah diimpor/diedit sama sekali" dari
 *  "sudah ada data asli". Lihat catatan di normalizeState soal auto-import. */
function isDummyEntitasList(rows: EntitasRow[]): boolean {
  return rows.length === ENTITAS_LIST.length && rows.every((r, i) => r.nama === ENTITAS_LIST[i]);
}

/** Sama seperti isDummyEntitasList tapi untuk supplierList — browser yang sempat kebuka sebelum
 *  supplierList berhenti di-seed dengan data dummy (["Supplier Rajut Jaya", dst]) akan otomatis
 *  ke-reset ke [] lewat normalizeState, bukan nyangkut dengan data contoh selamanya. */
function isDummySupplierList(rows: SupplierRow[]): boolean {
  return rows.length === SUPPLIERS.length && rows.every((r, i) => r.nama === SUPPLIERS[i]);
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function normalizeState(state: FlowState): Partial<FlowState> {
  // Entitas fallback SEKARANG dari master data (`entitasList`), bukan konstanta seed.ts lagi —
  // tapi normalizeState jalan SEBELUM entitasList sendiri sempat di-default di bawah, jadi fallback
  // 2 tingkat: entitasList kalau sudah ada (dari persist lama/import), baru ke ENTITAS_LIST kalau
  // benar-benar belum pernah ada (mis. localStorage lama sebelum fitur ini).
  const entitasFallback = state.entitasList?.[0]?.nama ?? ENTITAS_LIST[0];
  return {
    mrpDetails: dedupeById(
      state.mrpDetails.map((d) => ({
        ...d,
        id: d.mrp.id,
        ppicApproval: d.ppicApproval ?? "PPIC_APPROVED",
        materialRows: d.materialRows.map((m) => ({ ...m, entitas: m.entitas ?? entitasFallback })),
      }))
    ).map(({ id: _id, ...d }) => d),
    materialPOs: dedupeById(
      state.materialPOs.map((p) => ({
        ...p,
        colorBreakdown: p.colorBreakdown?.length
          ? p.colorBreakdown.map((c) => ({ ...c, entitas: c.entitas ?? p.entity ?? entitasFallback }))
          : [{ warna: p.warna, lengan: p.lengan, rollCount: p.rollCount, entitas: p.entity ?? entitasFallback }],
        invoicedByColor: p.invoicedByColor ?? {},
      }))
    ),
    maklonPOs: dedupeById(
      state.maklonPOs.map((m) => ({
        ...m,
        cancelledLines: (m.cancelledLines ?? []).map((c) => ({ ...c, time: c.time ?? "" })),
      }))
    ),
    invoices: dedupeById(
      state.invoices.map((i) => ({
        ...i,
        colorEntries: i.colorEntries ?? [],
        addBuys: i.addBuys ?? [],
        noInvoiceVendor: i.noInvoiceVendor ?? "",
        rollReceipts: i.rollReceipts ?? {},
        addBuyReceipts: i.addBuyReceipts ?? {},
      }))
    ),
    productionBatches: dedupeById(state.productionBatches ?? []),
    productionResults: dedupeById(state.productionResults ?? []),
    deliveryKolis: dedupeById(state.deliveryKolis ?? []),
    vendorInvoices: dedupeById(
      (state.vendorInvoices ?? []).map((i) => ({
        ...i,
        adjustments: i.adjustments ?? [],
        lines: i.lines.map((l) => ({ ...l, warna: l.warna ?? "", lengan: l.lengan ?? "PENDEK" })),
      }))
    ),
    maklonInvoices: dedupeById(state.maklonInvoices ?? []),
    notifications: dedupeById(state.notifications.map((n) => ({ ...n, audience: n.audience ?? [], read: n.read ?? true }))),
    productionGroupMeta: state.productionGroupMeta ?? [],
    rejectRemarks: state.rejectRemarks ?? {},
    materialClaimResolutions: state.materialClaimResolutions ?? {},
    materialClaimReturRequests: state.materialClaimReturRequests ?? {},
    hargaMaklon: dedupeById(state.hargaMaklon ?? []),
    hargaKain: dedupeById(state.hargaKain ?? []),
    hargaKainPks: dedupeById(state.hargaKainPks ?? []),
    // Kalau entitasList masih PERSIS sama dengan dummy lama (browser yang sempat kebuka sebelum
    // fix ini, sehingga sudah kepalang ke-persist dengan data dummy) ATAU belum ada sama sekali,
    // reset ke [] — supaya ImportSheetButton's autoImportIfEmpty di halaman Master Data > Entitas
    // kepicu dan langsung menarik data asli, bukan diam-diam terjebak dengan dummy selamanya.
    // Entitas yang sudah pernah diimpor/diedit manual (beda dari dummy) TIDAK disentuh.
    entitasList: dedupeById(
      state.entitasList && !isDummyEntitasList(state.entitasList) ? state.entitasList : []
    ),
    supplierList: dedupeById(state.supplierList && !isDummySupplierList(state.supplierList) ? state.supplierList : []),
  };
}

function now() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

type Getter = () => FlowState & FlowActions;
type Setter = (partial: Partial<FlowState>) => void;

let storeSet: Setter | null = null;

/** Auto-advance status PO maklon dari PRODUCTION ke DELIVERY begitu semua target Finish Good
 *  tercapai — menggantikan tombol manual "Tandai Selesai & Kirim" yang sebelumnya ada di
 *  halaman PO Produksi Saya (sekarang murni monitoring). Dipanggil setelah tiap kali hasil
 *  produksi (FG) baru dicatat. Tidak menyentuh PO yang statusnya bukan PRODUCTION (mis. sudah
 *  DELIVERY, atau masih menunggu bahan). */
function advanceMaklonToDeliveryIfFullyDone(
  mrpId: string,
  vendorProduksi: string,
  maklonPOs: MaklonPO[],
  mrpDetails: MrpDetail[],
  batches: ProductionBatch[],
  results: ProductionResult[]
): MaklonPO[] {
  const po = maklonPOs.find((m) => m.mrpId === mrpId && m.vendorProduksi === vendorProduksi);
  if (!po || po.status !== "PRODUCTION") return maklonPOs;
  if (!maklonProductionFullyDone(mrpId, vendorProduksi, mrpDetails, batches, results)) return maklonPOs;
  return maklonPOs.map((m) => (m.id === po.id ? { ...m, status: "DELIVERY" } : m));
}

function splitMaterialPoByEntitas(po: MaterialPO): MaterialPO[] {
  const groups = new Map<string, ColorBreakdown[]>();
  for (const c of po.colorBreakdown) {
    const ent = c.entitas ?? po.entity;
    groups.set(ent, [...(groups.get(ent) ?? []), c]);
  }
  if (groups.size <= 1) return [po];
  // Sisa (remainder) dari pembulatan dilempar ke grup TERAKHIR — bukan Math.round independen per
  // grup — supaya total amount hasil split selalu PERSIS sama dengan po.amount asli (independen
  // rounding bisa selisih beberapa rupiah, mis. split 1/1/1 roll dari Rp 1.000.000 masing2
  // Math.round(1.000.000/3)=333.333, jumlahnya 999.999, kurang Rp 1 dari amount asli).
  const entries = Array.from(groups.entries());
  let amountRemaining = po.amount;
  return entries.map(([entitas, colorBreakdown], idx) => {
    const rollCount = colorBreakdown.reduce((a, c) => a + c.rollCount, 0);
    const ratio = po.rollCount > 0 ? rollCount / po.rollCount : 0;
    const invoicedByColor: Record<string, number> = {};
    for (const c of colorBreakdown) {
      const key = c.warna + "|" + c.lengan;
      if (po.invoicedByColor[key] != null) invoicedByColor[key] = po.invoicedByColor[key];
    }
    const invoicedRolls = colorBreakdown.reduce((a, c) => a + (invoicedByColor[c.warna + "|" + c.lengan] ?? 0), 0);
    const isLast = idx === entries.length - 1;
    const amount = isLast ? amountRemaining : Math.round(po.amount * ratio);
    amountRemaining -= amount;
    return {
      ...po,
      id: nextId("PO-SUP"),
      warna: colorBreakdown.length === 1 ? colorBreakdown[0].warna : colorBreakdown.map((c) => c.warna).join(", "),
      lengan: colorBreakdown[0].lengan,
      colorBreakdown,
      invoicedByColor,
      rollCount,
      availableRolls: rollCount,
      invoicedRolls,
      amount,
      entity: entitas,
    };
  });
}

/** Pindahkan `moveQtyRoll` roll aduan pola (warna+lengan tertentu, milik fromVendor) ke toVendor —
 *  dipakai transferMaterial supaya baris Aduan Pola (yang menentukan grup Cutting vendor tujuan
 *  bisa lihat & potong roll ini, lihat production-cutting-tab.tsx) ikut pindah bareng invoice &
 *  MaklonPO, bukan cuma dua itu saja. Row yang qty roll-nya lebih besar dari yang perlu dipindah
 *  di-SPLIT jadi 2 (sisa tetap di fromVendor, potongan pindah ke toVendor) supaya qty roll aduan
 *  tetap akurat di kedua sisi — bukan asal timpa vendor di seluruh row. */
function reassignAduanRowsVendor(rows: AduanPolaRow[], fromVendor: string, toVendor: string, warna: string, lengan: Lengan, moveQtyRoll: number): AduanPolaRow[] {
  let remaining = moveQtyRoll;
  const next: AduanPolaRow[] = [];
  for (const row of rows) {
    if (remaining <= 0 || row.vendor !== fromVendor || row.warna !== warna || row.lengan !== lengan) {
      next.push(row);
      continue;
    }
    if (row.qtyRoll <= remaining) {
      next.push({ ...row, vendor: toVendor });
      remaining -= row.qtyRoll;
    } else {
      const moveFrac = remaining / row.qtyRoll;
      const movedQty = Math.round(row.qty * moveFrac);
      next.push({ ...row, qtyRoll: row.qtyRoll - remaining, qty: row.qty - movedQty });
      next.push({ ...row, id: nextId("AD"), qtyRoll: remaining, qty: movedQty, vendor: toVendor });
      remaining = 0;
    }
  }
  return next;
}

function checkPoApproved(get: Getter, set: Setter, mrpId: string) {
  const materialDone = get().materialPOs.filter((p) => p.mrpId === mrpId).every((p) => p.approved || p.status === "CANCELLED");
  const maklonDone = get().maklonPOs.filter((p) => p.mrpId === mrpId).every((p) => p.approved);
  if (materialDone && maklonDone) {
    set({ mrpDetails: get().mrpDetails.map((d) => (d.mrp.id === mrpId && !d.dates.poApproved ? { ...d, dates: { ...d.dates, poApproved: today() } } : d)) });
  }
}

export const useMrpStore = create<FlowState & FlowActions>()(
  persist(
    (set, get) => {
      storeSet = set;
      return {
      ...initialState,

      importMrp: (parsed, customId) => {
        const id = customId?.trim() || nextId("MRP");
        const idMap = new Map<string, string>();
        const lenganGroups = parsed.lenganGroups.map((g) => {
          const newId = id + "-" + g.id;
          idMap.set(g.id, newId);
          return { ...g, id: newId };
        });
        const aduanRows = parsed.aduanRows.map((a, i) => ({ ...a, id: id + "-ad-" + i, lenganGroupId: idMap.get(a.lenganGroupId) ?? a.lenganGroupId }));
        const defaultEntitas = get().entitasList[0]?.nama ?? ENTITAS_LIST[0];
        const materialRows = parsed.materialRows.map((m) => ({ ...m, id: id + "-" + m.id, lenganGroupId: idMap.get(m.lenganGroupId) ?? m.lenganGroupId, entitas: defaultEntitas }));
        const mrp: Mrp = { id, kategori: parsed.kategori, warna: parsed.warna, targetDate: "-", live: true, qty: parsed.qty, isFob: parsed.isFob };
        // Langsung WAITING_PPIC_APPROVAL (bukan DRAFT) — MRP belum bisa diedit lagi setelah
        // import, jadi tidak ada tahap "draft" yang perlu ditahan PPIC dulu sebelum diajukan;
        // begitu selesai import, otomatis masuk antrean approval SCM (lihat approvePpicMrp) —
        // Procurement baru bisa melihat/bikin PO-nya setelah SCM approve (lihat selectable di
        // app/procurement/po-approval/page.tsx).
        set({
          mrpDetails: [
            ...get().mrpDetails,
            { mrp, lenganGroups, aduanRows, materialRows, poSent: false, dates: { created: today(), ppicSubmitted: today() }, ppicApproval: "WAITING_PPIC_APPROVAL" },
          ],
          notifications: [
            { id: nextId("NTF"), text: `MRP ${id} diajukan PPIC — menunggu approval SCM sebelum diproses Procurement`, time: now(), audience: ["scm"], read: false },
            ...get().notifications,
          ],
        });
        return id;
      },

      switchAduanVendor: (mrpId, aduanId, toVendor) => {
        set({
          mrpDetails: get().mrpDetails.map((d) =>
            d.mrp.id !== mrpId ? d : { ...d, aduanRows: d.aduanRows.map((a) => (a.id === aduanId ? { ...a, vendor: toVendor } : a)) }
          ),
        });
      },

      assignMaterialSupplier: (mrpId, materialRowId, supplier) => {
        set({
          mrpDetails: get().mrpDetails.map((d) =>
            d.mrp.id !== mrpId ? d : { ...d, materialRows: d.materialRows.map((m) => (m.id === materialRowId ? { ...m, supplier } : m)) }
          ),
        });
      },

      assignMaterialEntitas: (mrpId, materialRowId, entitas) => {
        set({
          mrpDetails: get().mrpDetails.map((d) =>
            d.mrp.id !== mrpId ? d : { ...d, materialRows: d.materialRows.map((m) => (m.id === materialRowId ? { ...m, entitas } : m)) }
          ),
        });
      },

      approvePpicMrp: (mrpId) => {
        set({
          mrpDetails: get().mrpDetails.map((d) => (d.mrp.id === mrpId ? { ...d, ppicApproval: "PPIC_APPROVED", dates: { ...d.dates, ppicApproved: today() } } : d)),
          notifications: [
            { id: nextId("NTF"), text: `MRP ${mrpId} disetujui SCM — siap diproses Procurement`, time: now(), audience: ["ppic", "procurement"], read: false },
            ...get().notifications,
          ],
        });
      },

      rejectPpicMrp: (mrpId, reason) => {
        const d = get().mrpDetails.find((x) => x.mrp.id === mrpId);
        if (!d) return;
        set({
          mrpDetails: get().mrpDetails.map((x) => (x.mrp.id === mrpId ? { ...x, ppicApproval: "REJECTED", ppicRejectionNote: reason } : x)),
          notifications: [
            { id: nextId("NTF"), text: `MRP ${mrpId} DITOLAK SCM — alasan: ${reason}. Cek kembali datanya lalu impor ulang kalau perlu.`, time: now(), audience: ["ppic"], read: false },
            ...get().notifications,
          ],
        });
      },

      sendPoToFinance: (mrpId) => {
        const detail = get().mrpDetails.find((d) => d.mrp.id === mrpId);
        if (!detail) return;

        // Fase 2: amount PO Maklon sekarang lookup bertingkat dari Master Data > Harga Maklon
        // (per lengan + kapasitas kumulatif), bukan flat VENDOR_PRODUKSI.ratePerPc lagi — lihat
        // maklonAmountForVendor di lib/mrp/derive.ts. Perlu breakdown per-baris (bukan cuma
        // total qty per vendor) makanya vendorRows menyimpan AduanPolaRow[], bukan angka.
        const vendorRows = new Map<string, AduanPolaRow[]>();
        for (const a of detail.aduanRows) {
          const arr = vendorRows.get(a.vendor) ?? [];
          arr.push(a);
          vendorRows.set(a.vendor, arr);
        }
        const { hargaMaklon } = get();

        const maklonPOs: MaklonPO[] = Array.from(vendorRows.entries()).map(([vendor, rows]) => ({
          id: nextId("PO-MKL"),
          mrpId,
          vendorProduksi: vendor,
          qty: rows.reduce((s, r) => s + r.qty, 0),
          amount: maklonAmountForVendor(hargaMaklon, vendor, rows),
          entity: "PT Tigalapan Sukses Indo",
          status: "FULL_WAITING_MATERIAL",
          approved: false,
          cancelledLines: [],
        }));

        const pairTotals = new Map<
          string,
          { vendor: string; supplier: string; rolls: number; colorMap: Map<string, ColorBreakdown> }
        >();
        const defaultEntitas = get().entitasList[0]?.nama ?? ENTITAS_LIST[0];
        for (const a of detail.aduanRows) {
          const mr = detail.materialRows.find((m) => m.lenganGroupId === a.lenganGroupId);
          const supplier = mr?.supplier;
          if (!supplier) continue;
          const key = a.vendor + "|" + supplier;
          const cur = pairTotals.get(key) ?? { vendor: a.vendor, supplier, rolls: 0, colorMap: new Map<string, ColorBreakdown>() };
          cur.rolls += a.qtyRoll;
          const colorKey = a.warna + "|" + a.lengan;
          const cc = cur.colorMap.get(colorKey) ?? { warna: a.warna, lengan: a.lengan, rollCount: 0, entitas: mr.entitas ?? defaultEntitas };
          cc.rollCount += a.qtyRoll;
          cur.colorMap.set(colorKey, cc);
          pairTotals.set(key, cur);
        }

        const { hargaKain, hargaKainPks } = get();

        const materialPOs: MaterialPO[] = Array.from(pairTotals.values()).map((p) => {
          const colorBreakdown = Array.from(p.colorMap.values());
          const entitasCounts = new Map<string, number>();
          for (const c of colorBreakdown) entitasCounts.set(c.entitas ?? defaultEntitas, (entitasCounts.get(c.entitas ?? defaultEntitas) ?? 0) + c.rollCount);
          const majorityEntitas = Array.from(entitasCounts.entries()).sort((a2, b2) => b2[1] - a2[1])[0]?.[0] ?? defaultEntitas;
          return {
            id: nextId("PO-SUP"),
            mrpId,
            vendorProduksi: p.vendor,
            supplier: p.supplier,
            warna: colorBreakdown.length === 1 ? colorBreakdown[0].warna : colorBreakdown.map((c) => c.warna).join(", "),
            lengan: colorBreakdown[0].lengan,
            colorBreakdown,
            invoicedByColor: {},
            rollCount: p.rolls,
            availableRolls: p.rolls,
            invoicedRolls: 0,
            // Fase 2: lookup bertingkat dari Master Data > Harga Kain/Harga Kain PKS (1 roll =
            // 25kg, tonase per warna) — bukan flat MATERIAL_RATE_PER_ROLL/roll lagi. Lihat
            // materialAmountForPo di lib/mrp/derive.ts.
            amount: materialAmountForPo(hargaKain, hargaKainPks, p.supplier, colorBreakdown),
            entity: majorityEntitas,
            status: "WAITING_INVOICE",
            approved: false,
            daysSincePO: 0,
          };
        });

        set({
          materialPOs: [...get().materialPOs, ...materialPOs],
          maklonPOs: [...get().maklonPOs, ...maklonPOs],
          mrpDetails: get().mrpDetails.map((d) => (d.mrp.id === mrpId ? { ...d, poSent: true, dates: { ...d.dates, poSent: today() } } : d)),
          notifications: [
            {
              id: nextId("NTF"),
              text: `PO untuk ${mrpId} dikirim ke Finance — ${materialPOs.length} PO material, ${maklonPOs.length} PO maklon`,
              time: now(),
              audience: ["finance"],
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      approveMaterialPo: (id) => {
        const po = get().materialPOs.find((p) => p.id === id);
        if (!po) return;
        const parts = splitMaterialPoByEntitas(po).map((p) => ({ ...p, approved: true }));
        set({ materialPOs: get().materialPOs.filter((p) => p.id !== id).concat(parts) });
        checkPoApproved(get, set, po.mrpId);
      },

      setMaterialPoEntity: (poId, entitas) => {
        set({
          materialPOs: get().materialPOs.map((p) =>
            p.id !== poId ? p : { ...p, entity: entitas, colorBreakdown: p.colorBreakdown.map((c) => ({ ...c, entitas })) }
          ),
        });
      },

      // Set entitas untuk SATU baris warna/lengan saja di dalam 1 PO — dipakai untuk kasus 1
      // warna butuh entitas beda dari warna lain di PO yang sama (walau dari supplier & tujuan
      // vendor produksi yang sama). setMaterialPoEntity di atas tetap ada sebagai cara cepat
      // "set semua warna di PO ini ke entitas X sekaligus" — baru baris yang perlu beda di-override
      // lewat action ini. splitMaterialPoByEntitas (dipanggil approveMaterialPo) sudah otomatis
      // memecah 1 PO jadi beberapa PO approved terpisah per entitas begitu ada campuran.
      setMaterialPoColorEntity: (poId, warna, lengan, entitas) => {
        set({
          materialPOs: get().materialPOs.map((p) =>
            p.id !== poId ? p : { ...p, colorBreakdown: p.colorBreakdown.map((c) => (c.warna === warna && c.lengan === lengan ? { ...c, entitas } : c)) }
          ),
        });
      },

      approveAllMaterialPos: () => {
        const toApprove = get().materialPOs.filter((po) => !po.approved && po.status !== "CANCELLED");
        const mrpIds = Array.from(new Set(toApprove.map((po) => po.mrpId)));
        const toApproveIds = new Set(toApprove.map((po) => po.id));
        let next = get().materialPOs.filter((po) => !toApproveIds.has(po.id));
        for (const po of toApprove) next = next.concat(splitMaterialPoByEntitas(po).map((p) => ({ ...p, approved: true })));
        set({ materialPOs: next });
        mrpIds.forEach((id) => checkPoApproved(get, set, id));
      },

      approveVendorMaterialPos: (mrpId, vendor) => {
        const toApprove = get().materialPOs.filter((po) => po.mrpId === mrpId && po.vendorProduksi === vendor && !po.approved && po.status !== "CANCELLED");
        const toApproveIds = new Set(toApprove.map((po) => po.id));
        let next = get().materialPOs.filter((po) => !toApproveIds.has(po.id));
        for (const po of toApprove) next = next.concat(splitMaterialPoByEntitas(po).map((p) => ({ ...p, approved: true })));
        set({ materialPOs: next });
        checkPoApproved(get, set, mrpId);
      },

      approveMaklonPo: (id) => {
        const po = get().maklonPOs.find((p) => p.id === id);
        set({
          // Approve HANYA mengubah `approved`, status "menunggu bahan" (FULL/PARTIAL) tetap
          // dipertahankan apa adanya — jangan dipaksa jadi PARTIAL di sini. PARTIAL cuma berarti
          // "ada baris material yang pernah dibatalkan Procurement" (lihat closePoWithReason),
          // BUKAN indikator approval. Bug lama: baris ini selalu overwrite ke PARTIAL walau PO
          // belum pernah kena pembatalan sama sekali, jadi PO yang baru disetujui salah tampil
          // "PARTIAL WAITING MATERIAL" padahal seharusnya masih "FULL WAITING MATERIAL".
          maklonPOs: get().maklonPOs.map((p) => (p.id === id ? { ...p, approved: true } : p)),
          notifications: po
            ? [
                {
                  id: nextId("NTF"),
                  text: `PO Produksi ${po.id} untuk ${po.mrpId} telah disetujui Finance — cek menu PO Produksi Saya`,
                  time: now(),
                  audience: ["vendorMaklon"],
                  vendorId: po.vendorProduksi,
                  read: false,
                },
                ...get().notifications,
              ]
            : get().notifications,
        });
        if (po) checkPoApproved(get, set, po.mrpId);
      },

      bookInvoice: (poId, input) => {
        const po = get().materialPOs.find((p) => p.id === poId);
        if (!po) return;
        const qtyReady = input.colorEntries.reduce((a, c) => a + c.rolls.length, 0);
        const materialTotal = input.colorEntries.reduce((a, c) => a + c.hargaPerRoll * c.rolls.reduce((s, w) => s + w, 0), 0);
        const addBuyTotal = input.addBuys.reduce((a, b) => a + b.totalHarga, 0);
        const totalBiaya = materialTotal + addBuyTotal - input.diskon;
        const invoice: RawMaterialInvoice = {
          id: nextId("INV"),
          poId,
          mrpId: po.mrpId,
          vendorProduksi: po.vendorProduksi,
          supplier: po.supplier,
          colorEntries: input.colorEntries,
          addBuys: input.addBuys,
          qtyReady,
          diskon: input.diskon,
          totalBiaya,
          kodeTransaksi: input.kodeTransaksi,
          noInvoiceVendor: input.noInvoiceVendor,
          entity: po.entity,
          status: "INVOICED",
          destinationVendor: po.vendorProduksi,
          bookedAt: today(),
          // Belum ada backend/object storage (lihat diskusi deploy) — bukti PV disimpan langsung
          // sebagai data URI base64 di state ini untuk sekarang. Begitu nanti migrasi ke
          // Supabase Storage, field ini tinggal diganti isinya jadi URL file di Storage, bentuk
          // datanya (string) tidak perlu berubah di consumer manapun.
          buktiPvDataUrl: input.buktiPvDataUrl,
          buktiPvFileName: input.buktiPvFileName,
          rollReceipts: {},
          addBuyReceipts: {},
        };
        const invoicedRolls = po.invoicedRolls + qtyReady;
        const invoicedByColor = { ...po.invoicedByColor };
        for (const c of input.colorEntries) {
          const key = c.warna + "|" + c.lengan;
          invoicedByColor[key] = (invoicedByColor[key] ?? 0) + c.rolls.length;
        }

        // Kunci alokasi roll Aduan Pola per warna pada voucher ini, supaya roll yang sama
        // tidak bisa dipakai lagi sebagai dasar berat rib pada voucher berikutnya.
        const rollsByWarna = new Map<string, number>();
        for (const c of input.colorEntries) rollsByWarna.set(c.warna, (rollsByWarna.get(c.warna) ?? 0) + c.rolls.length);

        set({
          invoices: [invoice, ...get().invoices],
          materialPOs: get().materialPOs.map((p) =>
            p.id === poId ? { ...p, invoicedRolls, invoicedByColor, status: invoicedRolls >= p.rollCount ? "INVOICE" : p.status } : p
          ),
          mrpDetails: get().mrpDetails.map((d) => {
            if (d.mrp.id !== po.mrpId) return d;
            let aduanRows = d.aduanRows;
            for (const [warna, rollQty] of rollsByWarna.entries()) {
              let remainingQty = rollQty;
              aduanRows = aduanRows.map((a) => {
                if (remainingQty <= 0 || a.warna !== warna) return a;
                const avail = a.qtyRoll - (a.ribAllocatedRoll ?? 0);
                if (avail <= 0) return a;
                const use = Math.min(avail, remainingQty);
                remainingQty -= use;
                return { ...a, ribAllocatedRoll: (a.ribAllocatedRoll ?? 0) + use };
              });
            }
            return { ...d, aduanRows, dates: !d.dates.firstInvoice ? { ...d.dates, firstInvoice: today() } : d.dates };
          }),
        });
      },

      closePoWithReason: (poId, reason, warna, lengan, closeQty) => {
        const po = get().materialPOs.find((p) => p.id === poId);
        if (!po) return;
        const colorKey = warna + "|" + lengan;
        const colorEntry = po.colorBreakdown.find((c) => c.warna === warna && c.lengan === lengan);
        if (!colorEntry) return;
        const invoicedForColor = po.invoicedByColor[colorKey] ?? 0;
        const colorRemaining = colorEntry.rollCount - invoicedForColor;
        const qty = Math.max(1, Math.min(closeQty, colorRemaining));

        const newColorBreakdown = po.colorBreakdown.map((c) => (c.warna === warna && c.lengan === lengan ? { ...c, rollCount: c.rollCount - qty } : c));
        const newRollCount = po.rollCount - qty;
        const fullyClosed = newRollCount <= po.invoicedRolls;

        const detail = get().mrpDetails.find((d) => d.mrp.id === po.mrpId);
        let pcsRemoved = 0;
        if (detail) {
          const colorAduanRows = detail.aduanRows.filter((a) => a.vendor === po.vendorProduksi && a.warna === warna && a.lengan === lengan);
          const colorTotalRolls = colorAduanRows.reduce((s, a) => s + a.qtyRoll, 0);
          const colorTotalQty = colorAduanRows.reduce((s, a) => s + a.qty, 0);
          if (colorTotalRolls > 0) pcsRemoved = Math.round(colorTotalQty * (qty / colorTotalRolls));
        }

        // Fase 2: material di-recompute PENUH lewat lookup Master Data (data lengkap tersedia di
        // sini: po.supplier + newColorBreakdown sudah punya warna/lengan/rollCount). Maklon TETAP
        // pakai "rate efektif" (amount/qty PO saat ini) diterapkan ke qty baru — MaklonPO tidak
        // punya breakdown per-lengan untuk re-derive tier dari nol di titik ini (lihat catatan
        // scope Fase 2).
        set({
          materialPOs: get().materialPOs.map((p) =>
            p.id === poId
              ? {
                  ...p,
                  colorBreakdown: newColorBreakdown,
                  rollCount: newRollCount,
                  amount: materialAmountForPo(get().hargaKain, get().hargaKainPks, p.supplier, newColorBreakdown),
                  status: fullyClosed ? "CANCELLED" : p.status,
                }
              : p
          ),
          maklonPOs: get().maklonPOs.map((m) => {
            if (m.mrpId !== po.mrpId || m.vendorProduksi !== po.vendorProduksi) return m;
            const newQty = Math.max(0, m.qty - pcsRemoved);
            return {
              ...m,
              qty: newQty,
              amount: m.qty > 0 ? Math.round((m.amount / m.qty) * newQty) : 0,
              status: pcsRemoved > 0 && m.status === "FULL_WAITING_MATERIAL" ? "PARTIAL_WAITING_MATERIAL" : m.status,
              cancelledLines: [...m.cancelledLines, { note: reason, rolls: qty, warna, lengan, pcs: pcsRemoved, from: "Procurement", time: now() }],
            };
          }),
          notifications: [
            {
              id: nextId("NTF"),
              text: `PO ${poId} (${warna} · ${lengan}) ditutup ${fullyClosed ? "penuh" : "sebagian"} (${qty} roll) — alasan: ${reason}. PO Vendor Produksi ${VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi} ikut terpotong ${pcsRemoved} pcs.`,
              time: now(),
              audience: ["finance", "vendorMaklon"],
              vendorId: po.vendorProduksi,
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      reassignMaterialToSupplier: (poId, warna, lengan, moveQty, newSupplier, reason) => {
        const po = get().materialPOs.find((p) => p.id === poId);
        if (!po) return;
        const colorKey = warna + "|" + lengan;
        const colorEntry = po.colorBreakdown.find((c) => c.warna === warna && c.lengan === lengan);
        if (!colorEntry) return;
        const invoicedForColor = po.invoicedByColor[colorKey] ?? 0;
        const colorRemaining = colorEntry.rollCount - invoicedForColor;
        const qty = Math.max(1, Math.min(moveQty, colorRemaining));

        const newColorBreakdown = po.colorBreakdown.map((c) => (c.warna === warna && c.lengan === lengan ? { ...c, rollCount: c.rollCount - qty } : c));
        const newRollCount = po.rollCount - qty;
        const fullyClosed = newRollCount <= po.invoicedRolls;

        const { hargaKain, hargaKainPks } = get();
        const newColorBreakdownForSupplement: ColorBreakdown[] = [{ warna, lengan, rollCount: qty, entitas: colorEntry.entitas ?? po.entity }];
        const newPo: MaterialPO = {
          id: nextId("PO-SUP"),
          mrpId: po.mrpId,
          vendorProduksi: po.vendorProduksi,
          supplier: newSupplier,
          warna,
          lengan,
          colorBreakdown: newColorBreakdownForSupplement,
          invoicedByColor: {},
          rollCount: qty,
          availableRolls: qty,
          invoicedRolls: 0,
          amount: materialAmountForPo(hargaKain, hargaKainPks, newSupplier, newColorBreakdownForSupplement),
          entity: colorEntry.entitas ?? po.entity,
          status: "WAITING_INVOICE",
          approved: false,
          daysSincePO: 0,
        };

        // Beda dari closePoWithReason: maklonPOs SENGAJA TIDAK disentuh — kebutuhan produksi tetap
        // sama, cuma sumber materialnya pindah supplier lewat PO baru (newPo).
        set({
          materialPOs: [
            ...get().materialPOs.map((p) =>
              p.id === poId
                ? {
                    ...p,
                    colorBreakdown: newColorBreakdown,
                    rollCount: newRollCount,
                    amount: materialAmountForPo(hargaKain, hargaKainPks, p.supplier, newColorBreakdown),
                    status: fullyClosed ? "CANCELLED" : p.status,
                  }
                : p
            ),
            newPo,
          ],
          notifications: [
            {
              id: nextId("NTF"),
              text: `PO ${poId} (${warna} · ${lengan}, ${qty} roll) dialihkan dari supplier ${po.supplier} ke ${newSupplier} — alasan: ${reason}. PO material baru ${newPo.id} menunggu approval Finance. Kebutuhan produksi PO Vendor Produksi TIDAK berubah.`,
              time: now(),
              audience: ["finance"],
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      setInvoicesPaid: (invoiceIds, paid) => {
        set({
          invoices: get().invoices.map((inv) => {
            if (!invoiceIds.includes(inv.id)) return inv;
            if (paid) return inv.status === "INVOICED" ? { ...inv, status: "PAID", paidAt: today() } : inv;
            return inv.status === "PAID" ? { ...inv, status: "INVOICED", paidAt: undefined } : inv;
          }),
        });
        if (paid) {
          const firstInv = get().invoices.find((i) => invoiceIds.includes(i.id));
          const po = firstInv ? get().materialPOs.find((p) => p.id === firstInv.poId) : undefined;
          if (po) {
            set({
              mrpDetails: get().mrpDetails.map((d) => (d.mrp.id === po.mrpId && !d.dates.firstPayment ? { ...d, dates: { ...d.dates, firstPayment: today() } } : d)),
            });
          }
        }
      },

      setInvoicesDelivery: (invoiceIds, deliveryDate) => {
        set({
          invoices: get().invoices.map((inv) =>
            invoiceIds.includes(inv.id) && inv.status === "PAID" ? { ...inv, status: "DELIVERY", deliveredAt: deliveryDate } : inv
          ),
        });
      },

      transferMaterial: (items, toVendor, deliveryDate) => {
        let invoices = [...get().invoices];
        let maklonPOs = [...get().maklonPOs];
        let mrpDetails = [...get().mrpDetails];
        const newNotifications: Notification[] = [];

        for (const { invoiceId, qty } of items) {
          const invIdx = invoices.findIndex((i) => i.id === invoiceId);
          if (invIdx === -1) continue;
          const inv = invoices[invIdx];
          const fromVendor = inv.destinationVendor;
          if (fromVendor === toVendor) continue;
          const moveQty = Math.max(0, Math.min(qty, inv.qtyReady));
          if (moveQty <= 0) continue;

          let remaining = moveQty;
          const movedColorEntries: ColorEntry[] = [];
          const keptColorEntries: ColorEntry[] = [];
          for (const c of inv.colorEntries) {
            if (remaining <= 0) {
              keptColorEntries.push(c);
              continue;
            }
            const takeCount = Math.min(remaining, c.rolls.length);
            const movedRolls = c.rolls.slice(0, takeCount);
            const keptRolls = c.rolls.slice(takeCount);
            if (movedRolls.length > 0) movedColorEntries.push({ ...c, rolls: movedRolls });
            if (keptRolls.length > 0) keptColorEntries.push({ ...c, rolls: keptRolls });
            remaining -= takeCount;
          }
          const actualMoved = moveQty - remaining;
          if (actualMoved <= 0) continue;

          const detailIdx = mrpDetails.findIndex((d) => d.mrp.id === inv.mrpId);
          const detail = detailIdx !== -1 ? mrpDetails[detailIdx] : undefined;
          let pcsMoved = 0;
          // Fase 2: dikumpulkan JUGA per lengan (bukan cuma total) supaya PO Maklon vendor
          // TUJUAN yang baru dibuat (branch toIdx===-1 di bawah) bisa dihitung pakai lookup
          // Master Data bertingkat, bukan flat rate — lihat maklonAmountForLenganBuckets.
          const pcsMovedByLengan = new Map<Lengan, number>();
          let nextAduanRows = detail?.aduanRows ?? [];
          for (const c of movedColorEntries) {
            if (!detail) continue;
            const rows = detail.aduanRows.filter((a) => a.vendor === fromVendor && a.warna === c.warna && a.lengan === c.lengan);
            const totalRolls = rows.reduce((s, a) => s + a.qtyRoll, 0);
            const totalQty = rows.reduce((s, a) => s + a.qty, 0);
            if (totalRolls > 0) {
              const moved = Math.round(totalQty * (c.rolls.length / totalRolls));
              pcsMoved += moved;
              pcsMovedByLengan.set(c.lengan, (pcsMovedByLengan.get(c.lengan) ?? 0) + moved);
            }
            // Baris Aduan Pola warna+lengan ini ikut dipindah ke toVendor (sejumlah roll yang
            // benar-benar dipindah, c.rolls.length) — supaya tab Cutting vendor tujuan bisa lihat
            // & potong roll ini juga. Tanpa ini, invoice & MaklonPO sudah pindah tapi Aduan Pola
            // masih menunjuk vendor lama, jadi roll-nya "hilang" dari Cutting vendor tujuan (lihat
            // production-cutting-tab.tsx yang filter aduanRows strictly per vendor).
            nextAduanRows = reassignAduanRowsVendor(nextAduanRows, fromVendor, toVendor, c.warna, c.lengan, c.rolls.length);
          }
          if (detailIdx !== -1 && detail) {
            mrpDetails[detailIdx] = { ...detail, aduanRows: nextAduanRows };
          }

          if (keptColorEntries.length === 0) {
            invoices[invIdx] = {
              ...inv,
              destinationVendor: toVendor,
              status: "DELIVERY",
              deliveredAt: deliveryDate,
              receivedAt: undefined,
              productionStart: undefined,
              productionEnd: undefined,
              rollReceipts: {},
              addBuyReceipts: {},
            };
          } else {
            invoices[invIdx] = { ...inv, colorEntries: keptColorEntries, qtyReady: inv.qtyReady - actualMoved };
            const newInvoice: RawMaterialInvoice = {
              ...inv,
              id: nextId("INV"),
              colorEntries: movedColorEntries,
              qtyReady: actualMoved,
              destinationVendor: toVendor,
              status: "DELIVERY",
              deliveredAt: deliveryDate,
              receivedAt: undefined,
              productionStart: undefined,
              productionEnd: undefined,
              addBuys: [],
              rollReceipts: {},
              addBuyReceipts: {},
            };
            invoices = [...invoices, newInvoice];
          }

          if (pcsMoved > 0) {
            const fromIdx = maklonPOs.findIndex((m) => m.mrpId === inv.mrpId && m.vendorProduksi === fromVendor);
            if (fromIdx !== -1) {
              const m = maklonPOs[fromIdx];
              const newQty = Math.max(0, m.qty - pcsMoved);
              maklonPOs[fromIdx] = {
                ...m,
                qty: newQty,
                // Fase 2: preserve rate efektif (amount/qty saat ini) — tidak ada breakdown
                // per-lengan di titik ini untuk re-derive tier dari nol (lihat catatan scope).
                amount: m.qty > 0 ? Math.round((m.amount / m.qty) * newQty) : 0,
                cancelledLines: [
                  ...m.cancelledLines,
                  { note: `Material dipindahkan ke ${VENDOR_PRODUKSI[toVendor]?.name ?? toVendor}`, rolls: actualMoved, pcs: pcsMoved, from: "Procurement", time: now() },
                ],
              };
            }
            const toIdx = maklonPOs.findIndex((m) => m.mrpId === inv.mrpId && m.vendorProduksi === toVendor);
            if (toIdx !== -1) {
              const m = maklonPOs[toIdx];
              const newQty = m.qty + pcsMoved;
              maklonPOs[toIdx] = {
                ...m,
                qty: newQty,
                // Fase 2: preserve rate efektif — sama alasan seperti fromIdx di atas. Fallback
                // flat kalau PO existing-nya qty=0 (kasus langka).
                amount: m.qty > 0 ? Math.round((m.amount / m.qty) * newQty) : pcsMoved * (VENDOR_PRODUKSI[toVendor]?.ratePerPc ?? 7000),
                cancelledLines: [
                  ...m.cancelledLines,
                  { note: `Material diterima dari ${VENDOR_PRODUKSI[fromVendor]?.name ?? fromVendor}`, rolls: actualMoved, pcs: pcsMoved, from: "Procurement", time: now() },
                ],
              };
            } else {
              maklonPOs = [
                ...maklonPOs,
                {
                  id: nextId("PO-MKL"),
                  mrpId: inv.mrpId,
                  vendorProduksi: toVendor,
                  qty: pcsMoved,
                  // Fase 2: PO baru — punya breakdown per lengan (pcsMovedByLengan di atas),
                  // jadi bisa lookup bertingkat penuh, bukan preserve-rate seperti 2 kasus di atas.
                  amount: maklonAmountForLenganBuckets(
                    get().hargaMaklon,
                    toVendor,
                    Array.from(pcsMovedByLengan.entries()).map(([lengan, qty]) => ({ lengan, qty }))
                  ),
                  entity: "PT Tigalapan Sukses Indo",
                  status: "PARTIAL_WAITING_MATERIAL",
                  approved: true,
                  cancelledLines: [
                    { note: `Material diterima dari ${VENDOR_PRODUKSI[fromVendor]?.name ?? fromVendor}`, rolls: actualMoved, pcs: pcsMoved, from: "Procurement", time: now() },
                  ],
                },
              ];
            }
          }

          newNotifications.push(
            {
              id: nextId("NTF"),
              text: `${actualMoved} roll (${pcsMoved} pcs) material ${inv.mrpId} dipindahkan dari ${VENDOR_PRODUKSI[fromVendor]?.name ?? fromVendor} ke ${VENDOR_PRODUKSI[toVendor]?.name ?? toVendor}`,
              time: now(),
              audience: ["procurement", "finance"],
              read: false,
            },
            { id: nextId("NTF"), text: `PO Produksi Anda berkurang ${pcsMoved} pcs — sebagian material dipindahkan ke ${VENDOR_PRODUKSI[toVendor]?.name ?? toVendor}`, time: now(), audience: ["vendorMaklon"], vendorId: fromVendor, read: false },
            { id: nextId("NTF"), text: `PO Produksi Anda bertambah ${pcsMoved} pcs — menerima material dipindahkan dari ${VENDOR_PRODUKSI[fromVendor]?.name ?? fromVendor}`, time: now(), audience: ["vendorMaklon"], vendorId: toVendor, read: false }
          );
        }

        set({ invoices, maklonPOs, mrpDetails, notifications: [...newNotifications, ...get().notifications] });
      },

      advanceMaklonProduction: (id) => {
        // FULL_WAITING_MATERIAL & PARTIAL_WAITING_MATERIAL sama-sama status "menunggu bahan"
        // (beda cuma soal ada/tidaknya baris material yang dibatalkan Procurement) — keduanya
        // maju langsung ke PRODUCTION, bukan lewat satu sama lain (bug lama: array `order`
        // sebelumnya tidak menyertakan FULL_WAITING_MATERIAL sama sekali, jadi PO yang belum
        // pernah kena pembatalan material tidak akan pernah bisa maju status-nya).
        set({
          maklonPOs: get().maklonPOs.map((p) => {
            if (p.id !== id) return p;
            if (p.status === "FULL_WAITING_MATERIAL" || p.status === "PARTIAL_WAITING_MATERIAL") return { ...p, status: "PRODUCTION" };
            if (p.status === "PRODUCTION") return { ...p, status: "DELIVERY" };
            return p;
          }),
        });
      },

      // DEPRECATED (konsolidasi ke jalur Invoice Vendor per-pcs) — jalur Invoice Maklon per-PO
      // ditutup untuk pengajuan BARU karena vendor self-report penalty/bonus/retensi sendiri
      // tanpa direview Procurement, beda dengan Invoice Vendor yang direview & bisa dicicil
      // pembayarannya (lihat createVendorInvoice). Invoice Maklon yang SUDAH ADA (submitted
      // sebelum konsolidasi ini) tetap bisa di-approve/dibayar seperti biasa di Finance — cuma
      // pintu submit BARU yang ditutup, jadi action ini sekarang selalu no-op. UI pemicunya
      // sudah dilepas dari components/vendor-maklon/invoice-maklon-panel.tsx.
      submitMaklonInvoice: () => {},

      approveMaklonInvoice: (invoiceId) => {
        const inv = get().maklonInvoices.find((i) => i.id === invoiceId);
        set({
          maklonInvoices: get().maklonInvoices.map((i) => (i.id === invoiceId ? { ...i, status: "APPROVED", approvedAt: today() } : i)),
          notifications: inv
            ? [
                {
                  id: nextId("NTF"),
                  text: `Invoice maklon ${inv.id} disetujui Finance — menunggu payment`,
                  time: now(),
                  audience: ["vendorMaklon"],
                  vendorId: inv.vendorProduksi,
                  read: false,
                },
                ...get().notifications,
              ]
            : get().notifications,
        });
      },

      payMaklonInvoice: (invoiceId) => {
        const inv = get().maklonInvoices.find((i) => i.id === invoiceId);
        if (!inv) return;
        set({
          maklonInvoices: get().maklonInvoices.map((i) => (i.id === invoiceId ? { ...i, status: "PAID", paidAt: today() } : i)),
          maklonPOs: get().maklonPOs.map((p) => (p.id === inv.maklonPoId ? { ...p, status: "FULLY_PAID" } : p)),
          notifications: [
            {
              id: nextId("NTF"),
              text: `Invoice maklon ${inv.id} telah dibayar Finance`,
              time: now(),
              audience: ["vendorMaklon"],
              vendorId: inv.vendorProduksi,
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      receiveRawMaterialRoll: (invoiceId, warna, lengan, rollIndex, netKg, codeRoll, codeLot, claim) => {
        const inv = get().invoices.find((i) => i.id === invoiceId);
        if (!inv) return;
        const key = warna + "|" + lengan;
        const colorEntry = inv.colorEntries.find((c) => c.warna === warna && c.lengan === lengan);
        if (!colorEntry) return;
        const existing = inv.rollReceipts[key] ?? Array(colorEntry.rolls.length).fill(null);
        const nextArr = existing.map((r, idx) => (idx === rollIndex ? { netKg, receivedAt: today(), codeRoll, codeLot } : r));
        set({
          invoices: get().invoices.map((i) =>
            i.id === invoiceId
              ? {
                  ...i,
                  rollReceipts: { ...i.rollReceipts, [key]: nextArr },
                  status: i.status === "DELIVERY" ? "RECEIVING" : i.status,
                  receivedAt: i.receivedAt ?? today(),
                }
              : i
          ),
          notifications: claim
            ? [
                {
                  id: nextId("NTF"),
                  text: `Claim selisih berat — ${inv.poId} ${warna} · ${lengan} roll ${rollIndex + 1}: selisih ${claim.diffKg >= 0 ? "+" : ""}${claim.diffKg.toFixed(2)} kg (${claim.pct.toFixed(1)}%) di luar toleransi. Kode roll: ${codeRoll || "-"}, lot: ${codeLot || "-"}.`,
                  time: now(),
                  audience: ["procurement"],
                  read: false,
                },
                ...get().notifications,
              ]
            : get().notifications,
        });
      },

      receiveRawMaterialAddBuy: (invoiceId, addBuyId) => {
        set({
          invoices: get().invoices.map((i) =>
            i.id === invoiceId
              ? {
                  ...i,
                  addBuyReceipts: { ...i.addBuyReceipts, [addBuyId]: { receivedAt: today() } },
                  status: i.status === "DELIVERY" ? "RECEIVING" : i.status,
                  receivedAt: i.receivedAt ?? today(),
                }
              : i
          ),
        });
      },

      startProductionBatch: (input) => {
        const detail = get().mrpDetails.find((d) => d.mrp.id === input.mrpId);
        const aduanRow = detail?.aduanRows.find((a) => a.id === input.aduanRowId);
        if (!aduanRow) return;
        const batch: ProductionBatch = {
          id: nextId("BATCH"),
          mrpId: input.mrpId,
          vendorProduksi: aduanRow.vendor,
          aduanRowId: input.aduanRowId,
          kode: aduanRow.kode,
          warna: aduanRow.warna,
          lengan: aduanRow.lengan,
          qtyRoll: input.qtyRoll,
          gramasi: input.gramasi,
          restingAt: input.restingAt,
          createdAt: today(),
          codeRoll: input.codeRoll,
        };
        set({ productionBatches: [batch, ...get().productionBatches] });
      },

      updateBatchToCutting: (batchId, cuttingAt) => {
        set({ productionBatches: get().productionBatches.map((b) => (b.id === batchId ? { ...b, cuttingAt } : b)) });
      },

      submitProductionResult: (input) => {
        const groupKey = input.mrpId + "|" + input.warna + "|" + input.lengan;
        if (get().productionGroupMeta.some((g) => g.groupKey === groupKey && g.doneAt)) return;
        const maklon = get().maklonPOs.find((m) => m.mrpId === input.mrpId && m.vendorProduksi === input.vendorProduksi);
        const entry: ProductionResult = {
          id: nextId("PR"),
          groupKey,
          mrpId: input.mrpId,
          vendorProduksi: input.vendorProduksi,
          poId: maklon?.id ?? "",
          warna: input.warna,
          lengan: input.lengan,
          kind: input.kind,
          sizeQty: input.sizeQty,
          recordedAt: nowIso(),
          note: input.note,
        };
        const nextResults = [entry, ...get().productionResults];
        set({
          productionResults: nextResults,
          maklonPOs: advanceMaklonToDeliveryIfFullyDone(input.mrpId, input.vendorProduksi, get().maklonPOs, get().mrpDetails, get().productionBatches, nextResults),
        });
      },

      reworkRejectSize: (input) => {
        const sourceGroupKey = input.mrpId + "|" + input.warna + "|" + input.lengan;
        const outputGroupKey = input.mrpId + "|" + input.warna + "|" + input.toLengan;
        if (get().productionGroupMeta.some((g) => (g.groupKey === sourceGroupKey || g.groupKey === outputGroupKey) && g.doneAt)) return;
        const maklon = get().maklonPOs.find((m) => m.mrpId === input.mrpId && m.vendorProduksi === input.vendorProduksi);
        const common = {
          mrpId: input.mrpId,
          vendorProduksi: input.vendorProduksi,
          poId: maklon?.id ?? "",
          warna: input.warna,
          recordedAt: nowIso(),
        };
        const rejectAdj: ProductionResult = {
          ...common,
          id: nextId("PR"),
          groupKey: sourceGroupKey,
          lengan: input.lengan,
          kind: "REJECT",
          sizeQty: { [input.fromSize]: -input.qty },
          note: `Rework ${input.qty} pcs ke ${input.toLengan} size ${input.toSize} (${input.usia})`,
        };
        const fgAdj: ProductionResult = {
          ...common,
          id: nextId("PR"),
          groupKey: outputGroupKey,
          lengan: input.toLengan,
          kind: "FG",
          sizeQty: { [input.toSize]: input.qty },
          note: `Rework dari ${input.lengan} size ${input.fromSize} (${input.usia})`,
          usia: input.usia,
        };
        const nextResults = [fgAdj, rejectAdj, ...get().productionResults];
        set({
          productionResults: nextResults,
          maklonPOs: advanceMaklonToDeliveryIfFullyDone(input.mrpId, input.vendorProduksi, get().maklonPOs, get().mrpDetails, get().productionBatches, nextResults),
        });
      },

      createDeliveryKoli: (input) => {
        const koli: DeliveryKoli = {
          id: nextId("KOLI"),
          mrpId: input.mrpId,
          vendorProduksi: input.vendorProduksi,
          ekspedisi: input.ekspedisi,
          noKoli: input.noKoli,
          items: input.items,
          createdAt: today(),
        };
        set({ deliveryKolis: [koli, ...get().deliveryKolis] });
      },

      updateDeliveryKoli: (koliId, patch) => {
        const koli = get().deliveryKolis.find((k) => k.id === koliId);
        if (!koli || koli.deliveredAt) return;
        set({
          deliveryKolis: get().deliveryKolis.map((k) => (k.id === koliId ? { ...k, ekspedisi: patch.ekspedisi, noKoli: patch.noKoli, items: patch.items } : k)),
        });
      },

      setKoliWeight: (koliId, beratKoli) => {
        set({ deliveryKolis: get().deliveryKolis.map((k) => (k.id === koliId ? { ...k, beratKoli } : k)) });
      },

      markKoliDelivered: (koliId) => {
        const koli = get().deliveryKolis.find((k) => k.id === koliId);
        if (!koli || !koli.beratKoli) return;
        set({ deliveryKolis: get().deliveryKolis.map((k) => (k.id === koliId ? { ...k, deliveredAt: today() } : k)) });
      },

      createVendorInvoice: (input) => {
        // Cegah tagihan ganda: buang baris yang MRP+vendor-nya sudah terkunci ke jalur Invoice
        // Maklon (per-PO) — sisanya (kalau ada) tetap diproses seperti biasa.
        const unlockedInputLines = input.lines.filter(
          (l) => maklonPoInvoiceLockedBy(l.mrpId, input.vendorProduksi, get().maklonInvoices, get().vendorInvoices) !== "maklon"
        );
        if (unlockedInputLines.length === 0) return;
        const lines: VendorInvoiceLine[] = unlockedInputLines.map((l) => ({
          mrpId: l.mrpId,
          warna: l.warna,
          lengan: l.lengan,
          usia: l.usia,
          qty: l.qty,
          ratePerPc: l.ratePerPc,
          amount: l.qty * l.ratePerPc,
        }));
        const totalTagihan = lines.reduce((s, l) => s + l.amount, 0);
        const invoice: VendorInvoice = {
          id: nextId("VINV"),
          vendorProduksi: input.vendorProduksi,
          lines,
          totalTagihan,
          // Retensi sudah dihapus dari alur — netTagihan = totalTagihan (lihat catatan di
          // lib/mrp/types.ts VendorInvoice.netTagihan).
          netTagihan: totalTagihan,
          adjustments: [],
          status: "SUBMITTED",
          note: input.note,
          submittedAt: today(),
        };
        set({
          vendorInvoices: [invoice, ...get().vendorInvoices],
          notifications: [
            {
              id: nextId("NTF"),
              text: `Invoice vendor baru ${invoice.id} dari ${VENDOR_PRODUKSI[input.vendorProduksi]?.name ?? input.vendorProduksi} menunggu review Procurement`,
              time: now(),
              audience: ["procurement"],
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      setVendorInvoiceStatus: (invoiceId, status) => {
        const invoice = get().vendorInvoices.find((i) => i.id === invoiceId);
        const newNotifications: Notification[] = [];
        if (invoice && status === "APPROVED") {
          newNotifications.push({
            id: nextId("NTF"),
            text: `Invoice vendor ${invoice.id} disetujui Procurement — menunggu payment Finance`,
            time: now(),
            audience: ["finance", "vendorMaklon"],
            vendorId: invoice.vendorProduksi,
            read: false,
          });
        } else if (invoice && status === "PAID") {
          newNotifications.push({
            id: nextId("NTF"),
            text: `Invoice vendor ${invoice.id} telah dibayar Finance`,
            time: now(),
            audience: ["vendorMaklon"],
            vendorId: invoice.vendorProduksi,
            read: false,
          });
        }
        set({
          vendorInvoices: get().vendorInvoices.map((i) =>
            i.id === invoiceId
              ? { ...i, status, approvedAt: status === "APPROVED" ? today() : i.approvedAt, paidAt: status === "PAID" ? today() : i.paidAt }
              : i
          ),
          notifications: [...newNotifications, ...get().notifications],
        });
      },

      addVendorInvoiceAdjustment: (invoiceId, input) => {
        const invoice = get().vendorInvoices.find((i) => i.id === invoiceId);
        if (!invoice) return;
        const adjustment = { id: nextId("ADJ"), kind: input.kind, label: input.label, amount: input.amount, note: input.note, addedAt: today() };
        set({
          vendorInvoices: get().vendorInvoices.map((i) => (i.id === invoiceId ? { ...i, adjustments: [...(i.adjustments ?? []), adjustment] } : i)),
          notifications: [
            {
              id: nextId("NTF"),
              text:
                input.kind === "TIDAK_ADA"
                  ? `Catatan ditambahkan Procurement pada invoice ${invoice.id}: ${input.label} (tanpa sanksi)`
                  : `${input.kind === "DENDA" ? "Denda" : "Reward"} ditambahkan Procurement pada invoice ${invoice.id}: ${input.label} (Rp ${input.amount.toLocaleString("id-ID")})`,
              time: now(),
              audience: ["vendorMaklon"],
              vendorId: invoice.vendorProduksi,
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      setVendorInvoiceDueDate: (invoiceId, dueDate) => {
        set({ vendorInvoices: get().vendorInvoices.map((i) => (i.id === invoiceId ? { ...i, dueDate } : i)) });
      },

      setVendorInvoiceOngkir: (invoiceId, ongkirTotal) => {
        set({ vendorInvoices: get().vendorInvoices.map((i) => (i.id === invoiceId ? { ...i, ongkirTotal: Math.max(0, ongkirTotal) } : i)) });
      },

      payVendorInvoice: (invoiceId) => {
        const invoice = get().vendorInvoices.find((i) => i.id === invoiceId);
        if (!invoice || invoice.status === "PAID") return;
        set({
          vendorInvoices: get().vendorInvoices.map((i) => (i.id === invoiceId ? { ...i, status: "PAID", paidAt: today() } : i)),
          notifications: [
            {
              id: nextId("NTF"),
              text: `Invoice vendor ${invoice.id} telah dibayar lunas oleh Finance`,
              time: now(),
              audience: ["vendorMaklon"],
              vendorId: invoice.vendorProduksi,
              read: false,
            },
            ...get().notifications,
          ],
        });
      },

      markProductionGroupDone: (groupKey, mrpId, vendorProduksi, warna, lengan) => {
        const existing = get().productionGroupMeta.find((g) => g.groupKey === groupKey);
        // Reject sekarang dihitung OTOMATIS begitu FG ditandai selesai — bukan input manual lagi
        // (lihat ProductionResultPanel, tab "Reject Produksi" sekarang murni tampilan hasil
        // hitungan ini, tidak ada form input). Rumus: target cutting per size dikurangi FG yang
        // sudah dilaporkan untuk grup ini — size yang FG-nya sudah penuh/lebih tidak menghasilkan
        // reject (Math.max 0 lewat filter shortfall > 0).
        const target = targetSizesForGroup(mrpId, warna, lengan, get().mrpDetails, get().productionBatches);
        const fgRecorded = cumulativeSizeQtyForGroup(groupKey, "FG", get().productionResults);
        const rejectSizeQty: Record<string, number> = {};
        for (const [size, t] of Object.entries(target)) {
          const shortfall = t - (fgRecorded[size] ?? 0);
          if (shortfall > 0) rejectSizeQty[size] = shortfall;
        }
        // Buang entri auto-reject LAMA punya grup ini dulu sebelum nambah yang baru — tanpa ini,
        // alur "Done Produksi" -> "Buka kunci" (undoProductionGroupDone) -> tambah FG lagi ->
        // "Done Produksi" lagi akan MENUMPUK reject (bukan mengganti), karena shortfall dihitung
        // ulang dari nol tiap kali tapi entri lama tidak pernah dibuang — reject yang dilaporkan
        // jadi dobel/salah. Entri auto-reject dikenali lewat `!r.note` (lihat komentar di bawah);
        // entri adjustment rework (ber-note) TETAP dipertahankan, tidak ikut terbuang.
        let nextResults = get().productionResults.filter((r) => !(r.groupKey === groupKey && r.kind === "REJECT" && !r.note));
        if (Object.keys(rejectSizeQty).length > 0) {
          const maklon = get().maklonPOs.find((m) => m.mrpId === mrpId && m.vendorProduksi === vendorProduksi);
          // TIDAK diberi `note` — field itu dipakai sebagai penanda "ini entri adjustment rework"
          // (lihat rejectGrossForGroup/isReworkResult di derive.ts, yang MEMBUANG entri ber-note
          // dari hitungan gross). Entri auto ini justru harus kehitung SEBAGAI reject asli.
          const rejectEntry: ProductionResult = {
            id: nextId("PR"),
            groupKey,
            mrpId,
            vendorProduksi,
            poId: maklon?.id ?? "",
            warna,
            lengan,
            kind: "REJECT",
            sizeQty: rejectSizeQty,
            recordedAt: nowIso(),
          };
          nextResults = [rejectEntry, ...nextResults];
        }
        set({
          productionGroupMeta: existing
            ? get().productionGroupMeta.map((g) => (g.groupKey === groupKey ? { ...g, doneAt: today() } : g))
            : [...get().productionGroupMeta, { groupKey, mrpId, vendorProduksi, warna, lengan, doneAt: today() }],
          productionResults: nextResults,
          maklonPOs: advanceMaklonToDeliveryIfFullyDone(mrpId, vendorProduksi, get().maklonPOs, get().mrpDetails, get().productionBatches, nextResults),
        });
      },

      undoProductionGroupDone: (groupKey) => {
        set({
          productionGroupMeta: get().productionGroupMeta.map((g) => (g.groupKey === groupKey ? { ...g, doneAt: undefined } : g)),
        });
      },

      setRejectRemark: (poId, remark) => {
        set({ rejectRemarks: { ...get().rejectRemarks, [poId]: remark } });
      },

      resolveMaterialClaim: (key, note) => {
        set({ materialClaimResolutions: { ...get().materialClaimResolutions, [key]: { note, resolvedAt: today() } } });
      },

      unresolveMaterialClaim: (key) => {
        const next = { ...get().materialClaimResolutions };
        delete next[key];
        set({ materialClaimResolutions: next });
      },

      requestMaterialClaimRetur: (key, note) => {
        const claim = materialClaimsList(get().invoices).find((c) => c.key === key);
        set({
          materialClaimReturRequests: { ...get().materialClaimReturRequests, [key]: { note, requestedAt: today() } },
          notifications: claim
            ? [
                {
                  id: nextId("NTF"),
                  text: `Retur diminta ke supplier ${claim.supplier} untuk roll #${claim.rollIndex + 1} (${claim.warna} · ${claim.lengan}, invoice ${claim.invoiceId}). Timbang ulang roll ini begitu penggantinya sampai — catatan: ${note}`,
                  time: now(),
                  audience: ["vendorMaklon"],
                  vendorId: claim.vendorProduksi,
                  read: false,
                },
                ...get().notifications,
              ]
            : get().notifications,
        });
      },

      cancelMaterialClaimReturRequest: (key) => {
        const next = { ...get().materialClaimReturRequests };
        delete next[key];
        set({ materialClaimReturRequests: next });
      },

      markNotificationRead: (id) => {
        set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) });
      },

      markAllNotificationsRead: (ids) => {
        const idSet = new Set(ids);
        set({ notifications: get().notifications.map((n) => (idSet.has(n.id) ? { ...n, read: true } : n)) });
      },

      dismissNotification: (id) => {
        set({ notifications: get().notifications.filter((n) => n.id !== id) });
      },

      resetAll: () => {
        counter = 1;
        set({ ...initialState, mrpDetails: [] });
      },

      // ===== Master Data CRUD (lihat lib/mrp/masterData.ts) =====
      addHargaMaklonRow: () => {
        const row: HargaMaklonRow = { id: nextId("HMKL"), kodeVendor: "", namaVendor: "", tipeLengan: "PDK", jenisHarga: "Standar", harga: 0 };
        set({ hargaMaklon: [row, ...get().hargaMaklon] });
      },
      updateHargaMaklonRow: (id, patch) => {
        set({ hargaMaklon: get().hargaMaklon.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
      },
      deleteHargaMaklonRow: (id) => {
        set({ hargaMaklon: get().hargaMaklon.filter((r) => r.id !== id) });
      },
      replaceHargaMaklon: (rows) => {
        set({ hargaMaklon: rows.map((r) => ({ ...r, id: nextId("HMKL") })) });
      },

      addHargaKainRow: () => {
        const row: HargaKainRow = { id: nextId("HKAIN"), kodeSupplier: "", namaSupplier: "", kategori: "", warna: "", hargaPerKg: 0 };
        set({ hargaKain: [row, ...get().hargaKain] });
      },
      updateHargaKainRow: (id, patch) => {
        set({ hargaKain: get().hargaKain.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
      },
      deleteHargaKainRow: (id) => {
        set({ hargaKain: get().hargaKain.filter((r) => r.id !== id) });
      },
      replaceHargaKain: (rows) => {
        set({ hargaKain: rows.map((r) => ({ ...r, id: nextId("HKAIN") })) });
      },

      addHargaKainPksRow: () => {
        const row: HargaKainPksRow = { id: nextId("HKPKS"), kodeSupplier: "", kategori: "", warna: "", satuan: "TON", hargaPerKg: 0 };
        set({ hargaKainPks: [row, ...get().hargaKainPks] });
      },
      updateHargaKainPksRow: (id, patch) => {
        set({ hargaKainPks: get().hargaKainPks.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
      },
      deleteHargaKainPksRow: (id) => {
        set({ hargaKainPks: get().hargaKainPks.filter((r) => r.id !== id) });
      },
      replaceHargaKainPks: (rows) => {
        set({ hargaKainPks: rows.map((r) => ({ ...r, id: nextId("HKPKS") })) });
      },

      addEntitas: (nama) => {
        set({ entitasList: [{ id: nextId("ENT"), nama }, ...get().entitasList] });
      },
      updateEntitas: (id, nama) => {
        set({ entitasList: get().entitasList.map((r) => (r.id === id ? { ...r, nama } : r)) });
      },
      deleteEntitas: (id) => {
        set({ entitasList: get().entitasList.filter((r) => r.id !== id) });
      },
      replaceEntitas: (rows) => {
        set({ entitasList: rows.map((r) => ({ ...r, id: nextId("ENT") })) });
      },

      addSupplier: (nama) => {
        set({ supplierList: [{ id: nextId("SUP"), nama }, ...get().supplierList] });
      },
      updateSupplier: (id, nama) => {
        set({ supplierList: get().supplierList.map((r) => (r.id === id ? { ...r, nama } : r)) });
      },
      deleteSupplier: (id) => {
        set({ supplierList: get().supplierList.filter((r) => r.id !== id) });
      },
      replaceSupplier: (rows) => {
        set({ supplierList: rows.map((r) => ({ ...r, id: nextId("SUP") })) });
      },
      };
    },
    {
      name: "mrp-flow-v1",
      onRehydrateStorage: () => (state) => {
        if (state && storeSet) {
          bumpCounterPast(state);
          const normalized = normalizeState(state);
          // PENTING: cuma tulis balik ke localStorage kalau `normalized` benar-benar beda dari
          // `state` (ada migrasi/normalisasi yang benar-benar mengubah sesuatu). Tanpa guard ini,
          // `storeSet(normalized)` SELALU jalan di SETIAP rehydrate — termasuk rehydrate yang
          // dipicu tab lain lewat listener "storage" di bawah — dan karena `storeSet` itu `set`
          // yang sudah dibungkus `persist` (otomatis nulis ke localStorage tiap dipanggil), ini
          // bikin PING-PONG antar tab yang sedang terbuka bersamaan: Tab A nulis -> event
          // "storage" di Tab B&C -> mereka rehydrate -> ikut nulis balik (walau isinya sama) ->
          // event "storage" lagi di Tab A&lainnya -> rehydrate lagi -> nulis lagi -> tanpa henti.
          // Ini yang bikin tab lain kelihatan "loading terus" (CPU dipakai render berulang) DAN
          // data baru (mis. MRP yang baru dibuat, atau hasil import Master Data) bisa keTIMPA
          // balik oleh snapshot basi dari tab lain yang lagi kejebak siklus ini.
          const changed = (Object.keys(normalized) as (keyof FlowState)[]).some((key) => JSON.stringify(state[key]) !== JSON.stringify(normalized[key]));
          if (changed) storeSet(normalized);
        }
      },
    }
  )
);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "mrp-flow-v1") {
      useMrpStore.persist.rehydrate();
    }
  });
}
