import { create } from "zustand";
import type {
  AddBuyItem,
  AduanPolaRow,
  ColorEntry,
  DeliveryKoli,
  DeliveryKoliItem,
  Lengan,
  LenganGroup,
  MaklonInvoice,
  MaklonPO,
  MaterialPO,
  MaterialRow,
  Mrp,
  Notification,
  ProductionBatch,
  ProductionGroupMeta,
  ProductionResult,
  ProductionYieldResolution,
  RawMaterialInvoice,
  Usia,
  VendorInvoice,
  VendorInvoiceAdjustmentKind,
} from "./types";
import type { ParsedMrpImport } from "./parseImport";
import type { EntitasRow, HargaKainPksRow, HargaKainRow, HargaMaklonRow, SupplierRow } from "./masterData";
import * as rawActions from "./actions";

// Setiap Server Action di lib/mrp/actions.ts lempar Error("Unauthorized: ...") / Error("Forbidden:
// ...") kalau sesi login tidak valid/kedaluwarsa/salah role (lihat requireSession/
// requireInternalRole di lib/auth/session.ts). Tanpa penanganan ini, error itu jadi unhandled
// promise rejection di event handler halaman -> Next.js dev overlay nge-crash SELURUH halaman
// (bukan cuma gagal aksi yang barusan diklik).
//
// PERNAH dicoba pakai `new Proxy(rawActions, {...})` supaya tidak perlu ubah satu-satu di ~40
// tempat -- TERNYATA CRASH TOTAL di production build (tidak kelihatan di `next dev`/`tsc`!):
// export Server Action hasil bundling "use server" di production adalah properti non-writable +
// non-configurable pada namespace modul, dan spesifikasi Proxy MEWAJIBKAN `get` trap mengembalikan
// NILAI PERSIS SAMA untuk properti seperti itu -- Proxy saya mengembalikan fungsi WRAPPER (beda
// referensi), jadi browser melempar
// `TypeError: 'get' on proxy: property 'xxxAction' is a read-only and non-configurable data
// property on the proxy target but the proxy did not return its actual value`
// untuk SETIAP pemanggilan actions.xxxAction(...) -- akibatnya semua Server Action gagal total di
// production walau `npm run build` & `tsc --noEmit` sama sekali tidak mendeteksinya (murni runtime
// invariant JS, bukan type error). Diganti objek BIASA (bukan Proxy) berisi salinan tiap fungsi
// yang sudah dibungkus try/catch -- tidak men-trap akses ke modul asli sama sekali, jadi tidak
// kena invariant itu.
let redirectingForAuthError = false;
function guardAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (typeof window !== "undefined" && (message.startsWith("Unauthorized") || message.startsWith("Forbidden"))) {
        // Aksi yang gagal biasanya diikuti get().refresh() (juga dibungkus guardAction) -- tanpa
        // guard ini, refresh() akan gagal dengan error sesi yang SAMA lagi dan memicu alert +
        // redirect kedua. Cukup sekali per navigasi.
        if (!redirectingForAuthError) {
          redirectingForAuthError = true;
          window.alert("Sesi login Anda sudah tidak valid/kedaluwarsa. Anda akan diarahkan ke halaman login ulang.");
          window.location.href = "/";
        }
        return undefined as R;
      }
      throw err;
    }
  };
}

const actions = Object.fromEntries(
  Object.entries(rawActions).map(([key, fn]) => [key, guardAction(fn as (...args: unknown[]) => Promise<unknown>)])
) as typeof rawActions;

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
  ppicRejectionNote?: string;
};

export type FlowState = {
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
  materialClaimResolutions: Record<string, { note: string; resolvedAt: string }>;
  materialClaimReturRequests: Record<string, { note: string; requestedAt: string }>;
  /** Procurement menandai roll pengganti (hasil "Minta Retur") sudah dikirim ke vendor — tahap
   *  antara "Retur diminta" dan vendor benar2 timbang ulang di Cutting (lihat
   *  markMaterialClaimReturDeliveredAction). */
  materialClaimReturDeliveries: Record<string, { note: string; deliveredAt: string }>;
  /** Vendor mengonfirmasi roll pengganti sudah diterima fisik — dicatat terpisah dari timbang
   *  ulang karena konfirmasi terima bisa duluan sebelum sempat ditimbang (lihat
   *  confirmMaterialClaimReturReceivedAction). */
  materialClaimReturReceipts: Record<string, { receivedAt: string }>;
  /** Keyed by ProductionBatch.id — resolusi alert yield <99% (lihat productionYieldAlertsList di
   *  derive.ts), ditindaklanjuti dari portal internal Produksi (bukan Procurement). */
  productionYieldResolutions: Record<string, ProductionYieldResolution>;
  hargaMaklon: HargaMaklonRow[];
  hargaKain: HargaKainRow[];
  hargaKainPks: HargaKainPksRow[];
  entitasList: EntitasRow[];
  supplierList: SupplierRow[];
  /** True selama snapshot AWAL belum selesai di-fetch dari Supabase (lihat StoreHydrator di
   *  components/shell/store-hydrator.tsx). Halaman-halaman bisa pakai ini untuk skeleton/loading
   *  state kalau perlu -- opsional, tidak wajib dicek. */
  hydrated: boolean;
  /** True selama ADA action yang sedang berjalan (lihat withBusyTracking di bawah) -- dipakai
   *  components/shell/busy-overlay.tsx untuk nge-blok klik lain sampai selesai, supaya user
   *  tidak klik berulang kali (mis. dobel klik "Reset data" atau "Approve") selagi request masih
   *  diproses server. TIDAK ikut ke-trigger oleh polling/refresh background StoreHydrator (itu
   *  manggil getFlowSnapshotAction+hydrate langsung, bukan lewat action yang di-track ini). */
  busy: boolean;
};

// CATATAN MIGRASI SUPABASE (baca sebelum mengubah file ini):
// Store ini DULU (sebelum migrasi) satu-satunya sumber kebenaran, di-persist ke localStorage
// lewat zustand `persist` middleware, dan tiap action memutasi state secara LANGSUNG & SINKRON.
// Sekarang Supabase Postgres yang jadi sumber kebenaran (lihat lib/mrp/actions.ts, Server Actions
// yang benar-benar menulis ke database), dan store ini murni CACHE client-side:
//   1. `hydrate(snapshot)` dipanggil sekali oleh StoreHydrator saat app mount (fetch penuh lewat
//      getFlowSnapshotAction), dan lagi setiap kali sebuah action selesai (lihat refresh() di
//      bawah) -- BUKAN lagi lewat window "storage" event (localStorage-only hack, sudah dihapus).
//   2. Tiap action di FlowActions sekarang ASYNC: panggil Server Action yang sesuai (yang
//      melakukan validasi sesi + tulis ke Supabase), lalu refresh() snapshot supaya UI reflect
//      hasilnya. Tidak ada lagi optimistic update manual -- lebih sederhana & konsisten, walau
//      artinya UI menunggu 1 roundtrip server sebelum berubah (trade-off yang disengaja, lihat
//      plan migrasi).
//   3. Business logic (splitMaterialPoByEntitas, dsb.) SUDAH PINDAH ke lib/mrp/actions.ts /
//      lib/mrp/derive.ts -- file ini tidak boleh lagi berisi logika bisnis, cuma pemetaan
//      "action UI" -> "Server Action" + refresh.
//   4. SEBAGIAN action (lihat komentar `notYetMigrated` di bawah) BELUM diporting ke Supabase --
//      dipanggil tidak error, tapi TIDAK melakukan apa-apa (cuma console.warn), supaya UI lama
//      tidak crash sambil menunggu porting lanjutan. JANGAN anggap action-action itu berfungsi.
type FlowActions = {
  hydrate: (snapshot: FlowState) => void;
  refresh: () => Promise<void>;

  importMrp: (parsed: ParsedMrpImport, customId?: string) => Promise<string>;
  assignMaterialSupplier: (mrpId: string, materialRowIds: string[], supplier: string) => Promise<void>;
  assignMaterialEntitas: (mrpId: string, materialRowId: string, entitas: string) => Promise<void>;
  switchAduanVendor: (mrpId: string, aduanId: string, toVendor: string) => Promise<void>;
  approvePpicMrp: (mrpId: string) => Promise<void>;
  rejectPpicMrp: (mrpId: string, reason: string) => Promise<void>;
  sendPoToFinance: (mrpId: string) => Promise<void>;
  approveMaterialPo: (id: string) => Promise<void>;
  approveMaklonPo: (id: string) => Promise<void>;
  bookInvoice: (
    poId: string,
    input: { colorEntries: ColorEntry[]; addBuys: AddBuyItem[]; diskon: number; kodeTransaksi: string; noInvoiceVendor: string; buktiPvDataUrl?: string; buktiPvFileName?: string }
  ) => Promise<void>;
  setInvoicesPaid: (invoiceIds: string[], paid: boolean) => Promise<void>;
  setInvoicesDelivery: (invoiceIds: string[], deliveryDate: string) => Promise<void>;
  markRollArrived: (invoiceId: string, warna: string, lengan: Lengan, rollIndex: number, codeRoll?: string, codeLot?: string) => Promise<void>;
  receiveRawMaterialRoll: (invoiceId: string, warna: string, lengan: Lengan, rollIndex: number, netKg: number, claim?: { diffKg: number; pct: number }, codeRoll?: string) => Promise<void>;
  startProductionBatch: (input: { mrpId: string; aduanRowId: string; qtyRoll: number; gramasi: number; restingAt: string; codeRoll?: string }) => Promise<void>;
  // "WASTE" SENGAJA tidak termasuk di sini — satu-satunya jalur bikin entri WASTE adalah
  // wasteRejectSize (lihat di bawah), bukan submission FG/REJECT manual biasa ini.
  submitProductionResult: (input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; kind: "FG" | "REJECT"; sizeQty: Record<string, number>; note?: string }) => Promise<void>;
  createDeliveryKoli: (input: { mrpId: string; vendorProduksi: string; ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }) => Promise<void>;
  setKoliWeight: (koliId: string, beratKoli: number) => Promise<void>;
  markKoliDelivered: (koliId: string) => Promise<void>;
  createVendorInvoice: (input: { vendorProduksi: string; lines: { mrpId: string; warna: string; lengan: Lengan; usia?: Usia; qty: number; ratePerPc: number }[]; note?: string }) => Promise<void>;
  setVendorInvoiceStatus: (invoiceId: string, status: VendorInvoice["status"]) => Promise<void>;
  addVendorInvoiceAdjustment: (invoiceId: string, input: { kind: VendorInvoiceAdjustmentKind; label: string; amount: number; note?: string }) => Promise<void>;
  payVendorInvoice: (invoiceId: string) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: (ids: string[]) => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;

  addHargaMaklonRow: () => Promise<void>;
  updateHargaMaklonRow: (id: string, patch: Partial<HargaMaklonRow>) => Promise<void>;
  deleteHargaMaklonRow: (id: string) => Promise<void>;
  replaceHargaMaklon: (rows: HargaMaklonRow[]) => Promise<void>;
  addHargaKainRow: () => Promise<void>;
  updateHargaKainRow: (id: string, patch: Partial<HargaKainRow>) => Promise<void>;
  deleteHargaKainRow: (id: string) => Promise<void>;
  replaceHargaKain: (rows: HargaKainRow[]) => Promise<void>;
  addHargaKainPksRow: () => Promise<void>;
  updateHargaKainPksRow: (id: string, patch: Partial<HargaKainPksRow>) => Promise<void>;
  deleteHargaKainPksRow: (id: string) => Promise<void>;
  replaceHargaKainPks: (rows: HargaKainPksRow[]) => Promise<void>;
  addEntitas: (nama: string) => Promise<void>;
  updateEntitas: (id: string, nama: string) => Promise<void>;
  deleteEntitas: (id: string) => Promise<void>;
  replaceEntitas: (rows: EntitasRow[]) => Promise<void>;
  addSupplier: (nama: string) => Promise<void>;
  updateSupplier: (id: string, nama: string) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  replaceSupplier: (rows: SupplierRow[]) => Promise<void>;

  setMaterialPoEntity: (poId: string, entitas: string) => Promise<void>;
  setMaterialPoColorEntity: (poId: string, warna: string, lengan: Lengan, entitas: string) => Promise<void>;
  approveAllMaterialPos: () => Promise<void>;
  approveVendorMaterialPos: (mrpId: string, vendor: string) => Promise<void>;
  closePoWithReason: (poId: string, reason: string, warna: string, lengan: Lengan, closeQty: number) => Promise<void>;
  reassignMaterialToSupplier: (poId: string, warna: string, lengan: Lengan, moveQty: number, newSupplier: string, reason: string) => Promise<void>;
  transferMaterial: (items: { invoiceId: string; qty: number }[], toVendor: string, deliveryDate: string) => Promise<void>;
  advanceMaklonProduction: (id: string) => Promise<void>;
  submitMaklonInvoice: (maklonPoId: string, input: { penalty: number; bonus: number; retentionPct: number; note: string }) => Promise<void>;
  approveMaklonInvoice: (invoiceId: string) => Promise<void>;
  payMaklonInvoice: (invoiceId: string) => Promise<void>;
  receiveRawMaterialAddBuy: (invoiceId: string, addBuyId: string) => Promise<void>;
  updateBatchToCutting: (batchId: string, cuttingAt: string, sizeQty?: Record<string, number>) => Promise<void>;
  resolveProductionYield: (batchId: string, note: string) => Promise<void>;
  unresolveProductionYield: (batchId: string) => Promise<void>;
  reworkRejectSize: (input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; fromSize: string; qty: number; toLengan: Lengan; toSize: string; usia: Usia }) => Promise<void>;
  wasteRejectSize: (input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; fromSize: string; qty: number; note?: string }) => Promise<void>;
  updateDeliveryKoli: (koliId: string, patch: { ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }) => Promise<void>;
  setVendorInvoiceDueDate: (invoiceId: string, dueDate: string) => Promise<void>;
  setVendorInvoiceOngkir: (invoiceId: string, ongkirTotal: number) => Promise<void>;
  markProductionGroupDone: (groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan) => Promise<void>;
  undoProductionGroupDone: (groupKey: string) => Promise<void>;
  setRejectRemark: (poId: string, remark: string) => Promise<void>;
  resolveMaterialClaim: (key: string, note: string) => Promise<void>;
  unresolveMaterialClaim: (key: string) => Promise<void>;
  requestMaterialClaimRetur: (key: string, note: string) => Promise<void>;
  cancelMaterialClaimReturRequest: (key: string) => Promise<void>;
  markMaterialClaimReturDelivered: (key: string, note?: string) => Promise<void>;
  confirmMaterialClaimReturReceived: (key: string) => Promise<void>;
  /** Dulu menghapus semua data LOKAL (localStorage browser sendiri) + reload -- sekarang benar2
   *  menghapus data BERSAMA di Supabase (semua modul & vendor). Confirm dialog WAJIB ditampilkan
   *  di caller SEBELUM memanggil ini -- lihat components/shell/reset-data-button.tsx. */
  resetAll: () => Promise<void>;
};

const emptyState: FlowState = {
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
  materialClaimReturDeliveries: {},
  materialClaimReturReceipts: {},
  productionYieldResolutions: {},
  hargaMaklon: [],
  hargaKain: [],
  hargaKainPks: [],
  entitasList: [],
  supplierList: [],
  hydrated: false,
  busy: false,
};

function notYetMigrated(name: string) {
  console.warn(`[mrp-store] Action "${name}" belum diporting ke Supabase pasca migrasi -- tidak melakukan apa-apa. Lihat lib/mrp/store.ts.`);
}

/** Bungkus method yang namanya ada di `BUSY_TRACKED_ACTIONS` (lihat di bawah) supaya `busy`
 *  otomatis true selama method itu (dan `refresh()` yang dipanggil di akhirnya) masih berjalan --
 *  dipakai components/shell/busy-overlay.tsx utk nge-blok klik lain sampai selesai. Method yang
 *  TIDAK masuk daftar dibiarkan apa adanya (tetap async & tetap benar secara fungsional, cuma
 *  tidak memicu overlay). Counter (bukan boolean) supaya panggilan yang saling nested (mis. action
 *  manapun yang di dalamnya manggil get().refresh()) tetap dihitung benar -- busy baru balik false
 *  kalau SEMUA pemanggilan yang sedang berjalan sudah selesai. Ini objek BIASA (bukan Proxy) --
 *  lihat catatan panjang di `guardAction` di atas soal kenapa Proxy berbahaya untuk pola begini.
 */
// Cuma action yang (a) reset data, atau (b) benar-benar "oper" alur/data ke modul/role LAIN
// (approve, kirim PO, booking invoice, bayar, dst.) yang munculkan overlay -- klik kecil yang
// sering dipencet berkali-kali dalam satu sesi kerja (pilih entitas, tandai notifikasi dibaca,
// edit field kecil, dst.) SENGAJA tidak, supaya tidak berasa mengganggu/lambat.
const BUSY_TRACKED_ACTIONS = new Set<string>([
  "resetAll",
  "approvePpicMrp",
  "rejectPpicMrp",
  "sendPoToFinance",
  "approveMaterialPo",
  "approveAllMaterialPos",
  "approveVendorMaterialPos",
  "approveMaklonPo",
  "bookInvoice",
  "setInvoicesPaid",
  "setInvoicesDelivery",
  "approveMaklonInvoice",
  "payMaklonInvoice",
  "createVendorInvoice",
  "setVendorInvoiceStatus",
  "payVendorInvoice",
  "transferMaterial",
  "closePoWithReason",
  "reassignMaterialToSupplier",
  "createDeliveryKoli",
  "markKoliDelivered",
]);

function withBusyTracking<T extends Record<string, unknown>>(set: Setter, obj: T): T {
  let counter = 0;
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "function" || !BUSY_TRACKED_ACTIONS.has(key)) {
      wrapped[key] = value;
      continue;
    }
    wrapped[key] = async (...args: unknown[]) => {
      counter++;
      set({ busy: true });
      try {
        return await (value as (...a: unknown[]) => unknown)(...args);
      } finally {
        counter--;
        if (counter <= 0) {
          counter = 0;
          set({ busy: false });
        }
      }
    };
  }
  return wrapped as T;
}

type Setter = (partial: Partial<FlowState & FlowActions>) => void;

export const useMrpStore = create<FlowState & FlowActions>()((set, get) =>
  withBusyTracking(set, {
  ...emptyState,

  hydrate: (snapshot) => set({ ...snapshot, hydrated: true }),
  refresh: async () => {
    const { busy: _snapshotBusy, ...snapshot } = await actions.getFlowSnapshotAction();
    // `busy` SENGAJA tidak ikut di-spread -- refresh() ini sendiri sudah berjalan DI DALAM sebuah
    // action yang sedang di-tandai busy=true oleh withBusyTracking (lihat di atas); menimpanya di
    // sini akan bikin overlay loading kedip mati sesaat sebelum action pemanggilnya benar-benar
    // selesai.
    set({ ...snapshot, hydrated: true });
  },

  importMrp: async (parsed, customId) => {
    const id = await actions.importMrpAction(parsed, customId);
    await get().refresh();
    return id;
  },
  assignMaterialSupplier: async (mrpId, materialRowIds, supplier) => {
    await actions.assignMaterialSupplierAction(mrpId, materialRowIds, supplier);
    await get().refresh();
  },
  assignMaterialEntitas: async (mrpId, materialRowId, entitas) => {
    await actions.assignMaterialEntitasAction(mrpId, materialRowId, entitas);
    await get().refresh();
  },
  switchAduanVendor: async (mrpId, aduanId, toVendor) => {
    await actions.switchAduanVendorAction(mrpId, aduanId, toVendor);
    await get().refresh();
  },
  approvePpicMrp: async (mrpId) => {
    await actions.approvePpicMrpAction(mrpId);
    await get().refresh();
  },
  rejectPpicMrp: async (mrpId, reason) => {
    await actions.rejectPpicMrpAction(mrpId, reason);
    await get().refresh();
  },
  sendPoToFinance: async (mrpId) => {
    await actions.sendPoToFinanceAction(mrpId);
    await get().refresh();
  },
  approveMaterialPo: async (id) => {
    await actions.approveMaterialPoAction(id);
    await get().refresh();
  },
  approveMaklonPo: async (id) => {
    await actions.approveMaklonPoAction(id);
    await get().refresh();
  },
  bookInvoice: async (poId, input) => {
    await actions.bookInvoiceAction(poId, input);
    await get().refresh();
  },
  setInvoicesPaid: async (invoiceIds, paid) => {
    await actions.setInvoicesPaidAction(invoiceIds, paid);
    await get().refresh();
  },
  setInvoicesDelivery: async (invoiceIds, deliveryDate) => {
    await actions.setInvoicesDeliveryAction(invoiceIds, deliveryDate);
    await get().refresh();
  },
  markRollArrived: async (invoiceId, warna, lengan, rollIndex, codeRoll, codeLot) => {
    await actions.markRollArrivedAction(invoiceId, warna, lengan, rollIndex, codeRoll, codeLot);
    await get().refresh();
  },
  receiveRawMaterialRoll: async (invoiceId, warna, lengan, rollIndex, netKg, claim, codeRoll) => {
    await actions.receiveRawMaterialRollAction(invoiceId, warna, lengan, rollIndex, netKg, claim, codeRoll);
    await get().refresh();
  },
  startProductionBatch: async (input) => {
    await actions.startProductionBatchAction(input);
    await get().refresh();
  },
  submitProductionResult: async (input) => {
    await actions.submitProductionResultAction(input);
    await get().refresh();
  },
  createDeliveryKoli: async (input) => {
    await actions.createDeliveryKoliAction(input);
    await get().refresh();
  },
  setKoliWeight: async (koliId, beratKoli) => {
    await actions.setKoliWeightAction(koliId, beratKoli);
    await get().refresh();
  },
  markKoliDelivered: async (koliId) => {
    await actions.markKoliDeliveredAction(koliId);
    await get().refresh();
  },
  createVendorInvoice: async (input) => {
    await actions.createVendorInvoiceAction(input);
    await get().refresh();
  },
  setVendorInvoiceStatus: async (invoiceId, status) => {
    await actions.setVendorInvoiceStatusAction(invoiceId, status);
    await get().refresh();
  },
  addVendorInvoiceAdjustment: async (invoiceId, input) => {
    await actions.addVendorInvoiceAdjustmentAction(invoiceId, input);
    await get().refresh();
  },
  payVendorInvoice: async (invoiceId) => {
    await actions.payVendorInvoiceAction(invoiceId);
    await get().refresh();
  },
  markNotificationRead: async (id) => {
    await actions.markNotificationReadAction(id);
    await get().refresh();
  },
  markAllNotificationsRead: async (ids) => {
    await actions.markAllNotificationsReadAction(ids);
    await get().refresh();
  },
  dismissNotification: async (id) => {
    await actions.dismissNotificationAction(id);
    await get().refresh();
  },

  addHargaMaklonRow: async () => {
    await actions.addHargaMaklonRowAction();
    await get().refresh();
  },
  updateHargaMaklonRow: async (id, patch) => {
    await actions.updateHargaMaklonRowAction(id, patch);
    await get().refresh();
  },
  deleteHargaMaklonRow: async (id) => {
    await actions.deleteHargaMaklonRowAction(id);
    await get().refresh();
  },
  replaceHargaMaklon: async (rows) => {
    await actions.replaceHargaMaklonAction(rows);
    await get().refresh();
  },
  addHargaKainRow: async () => {
    await actions.addHargaKainRowAction();
    await get().refresh();
  },
  updateHargaKainRow: async (id, patch) => {
    await actions.updateHargaKainRowAction(id, patch);
    await get().refresh();
  },
  deleteHargaKainRow: async (id) => {
    await actions.deleteHargaKainRowAction(id);
    await get().refresh();
  },
  replaceHargaKain: async (rows) => {
    await actions.replaceHargaKainAction(rows);
    await get().refresh();
  },
  addHargaKainPksRow: async () => {
    await actions.addHargaKainPksRowAction();
    await get().refresh();
  },
  updateHargaKainPksRow: async (id, patch) => {
    await actions.updateHargaKainPksRowAction(id, patch);
    await get().refresh();
  },
  deleteHargaKainPksRow: async (id) => {
    await actions.deleteHargaKainPksRowAction(id);
    await get().refresh();
  },
  replaceHargaKainPks: async (rows) => {
    await actions.replaceHargaKainPksAction(rows);
    await get().refresh();
  },
  addEntitas: async (nama) => {
    await actions.addEntitasAction(nama);
    await get().refresh();
  },
  updateEntitas: async (id, nama) => {
    await actions.updateEntitasAction(id, nama);
    await get().refresh();
  },
  deleteEntitas: async (id) => {
    await actions.deleteEntitasAction(id);
    await get().refresh();
  },
  replaceEntitas: async (rows) => {
    await actions.replaceEntitasAction(rows);
    await get().refresh();
  },
  addSupplier: async (nama) => {
    await actions.addSupplierAction(nama);
    await get().refresh();
  },
  updateSupplier: async (id, nama) => {
    await actions.updateSupplierAction(id, nama);
    await get().refresh();
  },
  deleteSupplier: async (id) => {
    await actions.deleteSupplierAction(id);
    await get().refresh();
  },
  replaceSupplier: async (rows) => {
    await actions.replaceSupplierAction(rows);
    await get().refresh();
  },

  setMaterialPoEntity: async (poId, entitas) => {
    await actions.setMaterialPoEntityAction(poId, entitas);
    await get().refresh();
  },
  setMaterialPoColorEntity: async (poId, warna, lengan, entitas) => {
    await actions.setMaterialPoColorEntityAction(poId, warna, lengan, entitas);
    await get().refresh();
  },
  approveAllMaterialPos: async () => {
    await actions.approveAllMaterialPosAction();
    await get().refresh();
  },
  approveVendorMaterialPos: async (mrpId, vendor) => {
    await actions.approveVendorMaterialPosAction(mrpId, vendor);
    await get().refresh();
  },
  closePoWithReason: async (poId, reason, warna, lengan, closeQty) => {
    await actions.closePoWithReasonAction(poId, reason, warna, lengan, closeQty);
    await get().refresh();
  },
  reassignMaterialToSupplier: async (poId, warna, lengan, moveQty, newSupplier, reason) => {
    await actions.reassignMaterialToSupplierAction(poId, warna, lengan, moveQty, newSupplier, reason);
    await get().refresh();
  },
  transferMaterial: async (items, toVendor, deliveryDate) => {
    await actions.transferMaterialAction(items, toVendor, deliveryDate);
    await get().refresh();
  },
  advanceMaklonProduction: async (id) => {
    await actions.advanceMaklonProductionAction(id);
    await get().refresh();
  },
  submitMaklonInvoice: async () => {}, // sudah no-op sejak sebelum migrasi (jalur ditutup, lihat lib/mrp/actions.ts)
  approveMaklonInvoice: async (invoiceId) => {
    await actions.approveMaklonInvoiceAction(invoiceId);
    await get().refresh();
  },
  payMaklonInvoice: async (invoiceId) => {
    await actions.payMaklonInvoiceAction(invoiceId);
    await get().refresh();
  },
  receiveRawMaterialAddBuy: async (invoiceId, addBuyId) => {
    await actions.receiveRawMaterialAddBuyAction(invoiceId, addBuyId);
    await get().refresh();
  },
  updateBatchToCutting: async (batchId, cuttingAt, sizeQty) => {
    await actions.updateBatchToCuttingAction(batchId, cuttingAt, sizeQty);
    await get().refresh();
  },
  resolveProductionYield: async (batchId, note) => {
    await actions.resolveProductionYieldAction(batchId, note);
    await get().refresh();
  },
  unresolveProductionYield: async (batchId) => {
    await actions.unresolveProductionYieldAction(batchId);
    await get().refresh();
  },
  reworkRejectSize: async (input) => {
    await actions.reworkRejectSizeAction(input);
    await get().refresh();
  },
  wasteRejectSize: async (input) => {
    await actions.wasteRejectSizeAction(input);
    await get().refresh();
  },
  updateDeliveryKoli: async (koliId, patch) => {
    await actions.updateDeliveryKoliAction(koliId, patch);
    await get().refresh();
  },
  setVendorInvoiceDueDate: async (invoiceId, dueDate) => {
    await actions.setVendorInvoiceDueDateAction(invoiceId, dueDate);
    await get().refresh();
  },
  setVendorInvoiceOngkir: async (invoiceId, ongkirTotal) => {
    await actions.setVendorInvoiceOngkirAction(invoiceId, ongkirTotal);
    await get().refresh();
  },
  markProductionGroupDone: async (groupKey, mrpId, vendorProduksi, warna, lengan) => {
    await actions.markProductionGroupDoneAction(groupKey, mrpId, vendorProduksi, warna, lengan);
    await get().refresh();
  },
  undoProductionGroupDone: async (groupKey) => {
    await actions.undoProductionGroupDoneAction(groupKey);
    await get().refresh();
  },
  setRejectRemark: async (poId, remark) => {
    await actions.setRejectRemarkAction(poId, remark);
    await get().refresh();
  },
  resolveMaterialClaim: async (key, note) => {
    await actions.resolveMaterialClaimAction(key, note);
    await get().refresh();
  },
  unresolveMaterialClaim: async (key) => {
    await actions.unresolveMaterialClaimAction(key);
    await get().refresh();
  },
  requestMaterialClaimRetur: async (key, note) => {
    await actions.requestMaterialClaimReturAction(key, note);
    await get().refresh();
  },
  cancelMaterialClaimReturRequest: async (key) => {
    await actions.cancelMaterialClaimReturRequestAction(key);
    await get().refresh();
  },
  markMaterialClaimReturDelivered: async (key, note) => {
    await actions.markMaterialClaimReturDeliveredAction(key, note);
    await get().refresh();
  },
  confirmMaterialClaimReturReceived: async (key) => {
    await actions.confirmMaterialClaimReturReceivedAction(key);
    await get().refresh();
  },
  resetAll: async () => {
    await actions.resetAllAction();
    await get().refresh();
  },
}));
