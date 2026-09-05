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
  MaterialClaimHistory,
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
import { localDateString } from "./derive";
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
  /** Arsip/histori permanen tiap siklus klaim selisih berat, termasuk yang SUDAH SELESAI (auto
   *  atau manual) -- lihat migration 0011_material_claim_history.sql & tab "Riwayat/Arsip" di
   *  app/procurement/material-claims/page.tsx. Beda dari materialClaimResolutions/
   *  materialClaimReturRequests/dst di atas (yang cuma menyimpan status TERAKHIR untuk klaim yang
   *  MASIH AKTIF, langsung di kolom raw_material_invoice_rolls) -- begitu klaim tuntas & roll
   *  ditimbang ulang, kolom-kolom itu di-null-kan lagi (supaya roll_index yang sama bisa mulai
   *  bersih kalau kena klaim lagi), jadi tidak ada jejak historis di sana. */
  materialClaimHistory: MaterialClaimHistory[];
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
  // Item 2.6: getter-nya (getInvoicePaymentProofAction) SENGAJA tidak dilewatkan lewat store --
  // sama seperti getMaterialClaimPhotoAction, payload-nya on-demand murni, dipanggil langsung dari
  // komponen (lihat payment-panel.tsx / paying-voucher-material-panel.tsx).
  setInvoicePaymentProof: (invoiceIds: string[], dataUrl: string, fileName?: string) => Promise<void>;
  setInvoicesDelivery: (invoiceIds: string[], deliveryDate: string) => Promise<void>;
  markRollArrived: (invoiceId: string, warna: string, lengan: Lengan, rollIndex: number, codeRoll?: string, codeLot?: string) => Promise<void>;
  receiveRawMaterialRoll: (
    invoiceId: string,
    warna: string,
    lengan: Lengan,
    rollIndex: number,
    netKg: number,
    claim?: { diffKg: number; pct: number },
    codeRoll?: string,
    photo?: { dataUrl: string; fileName?: string }
  ) => Promise<void>;
  /** Item 13.2: tutup tahap "timbang" untuk sekelompok roll sekaligus (satu klik "Konfirmasi (n)"
   *  per warna·lengan, item 14.1) -- roll yang net_kg-nya belum diisi atau masih claimable di-skip
   *  & dilaporkan balik di `skipped`. */
  confirmRollWeigh: (items: { invoiceId: string; warna: string; lengan: Lengan; rollIndex: number }[]) => Promise<{ confirmed: number; skipped: { invoiceId: string; warna: string; lengan: Lengan; rollIndex: number }[] }>;
  startProductionBatch: (input: { mrpId: string; aduanRowId: string; qtyRoll: number; gramasi: number; restingAt: string; codeRoll?: string }) => Promise<void>;
  // "WASTE" SENGAJA tidak termasuk di sini -- item 19: "Buang ke Sisa" (satu-satunya jalur dulu
  // bikin entri WASTE) sudah dihapus, jadi kind di sini praktis selalu "FG"/"REJECT" saja.
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
  updateDeliveryKoli: (koliId: string, patch: { ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }) => Promise<void>;
  setVendorInvoiceDueDate: (invoiceId: string, dueDate: string) => Promise<void>;
  setVendorInvoiceOngkir: (invoiceId: string, ongkirTotal: number) => Promise<void>;
  /** TAHAP 1 -- "Selesai Produksi" di tab Finish Good (hitung reject, tidak mengunci rework). */
  confirmFgDone: (groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan) => Promise<void>;
  undoFgConfirm: (groupKey: string) => Promise<void>;
  /** TAHAP 2 -- "Selesai Produksi" di tab Final Produksi (kunci final, basis on-time/delay). */
  markProductionGroupDone: (groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan) => Promise<void>;
  undoProductionGroupDone: (groupKey: string) => Promise<void>;
  /** Item 21: "Close PO" per PO Produksi (mrpId+vendorProduksi) -- kunci SEMUA warna/lengannya
   *  sekaligus DAN blokir Pengiriman untuk sisa FG yang belum masuk koli (item 22). */
  closeProductionPo: (maklonPoId: string, reason: string) => Promise<void>;
  /** Kebalikan closeProductionPo -- buka lagi gerbang Pengiriman PO ini (lihat komentar lengkap di
   *  reopenProductionPoAction, lib/mrp/actions.ts). */
  reopenProductionPo: (maklonPoId: string) => Promise<void>;
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
  materialClaimHistory: [],
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
// (approve, kirim PO, booking invoice, bayar, dst.) yang dipagari lewat `busy` ini -- klik kecil
// yang sering dipencet berkali-kali dalam satu sesi kerja (pilih entitas, tandai notifikasi
// dibaca, edit field kecil, dst.) SENGAJA tidak, supaya tidak ada penundaan tambahan sama sekali
// sebelum klik berikutnya diterima.
//
// CATATAN (revisi 2026-09-05): `busy` DULU memicu overlay penuh layar yang TERLIHAT (spinner +
// teks "Memproses...", lihat busy-overlay.tsx) -- sekarang overlay itu dibuat transparan (fungsi
// blokir klik-nya TETAP SAMA PERSIS, cuma tidak lagi terlihat user). Jadi daftar di bawah ini
// sekarang murni soal PENCEGAHAN DOBEL-KLIK, bukan lagi soal "action mana yang layak bikin user
// menunggu terlihat" -- semua action tetap benar-benar menunggu tulisannya selesai (tidak berubah
// jadi optimistic), cuma penundaan itu tidak lagi ditampilkan ke user.
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
  "setInvoicePaymentProof",
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
  "closeProductionPo",
  "reopenProductionPo",
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

export const useMrpStore = create<FlowState & FlowActions>()((set, get) => {
  // PERFORMA: dulu SETIAP action di bawah ini nge-`await get().refresh()` sebelum selesai -- itu
  // artinya klik user menunggu 2 round-trip server BERURUTAN (tulis data, LALU fetch ulang
  // SELURUH data app -- 32 tabel, ratusan KB -- via getFlowSnapshotAction) sebelum tombolnya
  // "selesai loading". Diukur langsung ke Supabase: RPC snapshot penuh itu sendiri ~0.6-1.4 detik,
  // di atas biaya tulis datanya -- jadi tiap klik gampang kerasa 1-2+ detik hanya dari refresh-nya
  // saja, sebelum ditambah proses reshape & round-trip Server Action ke browser.
  //
  // refresh() sekarang dipanggil TANPA di-await (backgroundRefresh) di semua action -- write-nya
  // tetap ditunggu (jadi kalau gagal, errornya tetap kelempar ke caller seperti biasa), tapi
  // sync-ulang data TIDAK lagi memblokir selesainya klik. Ini aman karena refresh() cuma
  // re-fetch (read-only, idempotent) lalu `set()` ke store Zustand -- komponen yang subscribe
  // tetap otomatis re-render begitu itu selesai di background (biasanya <1 detik kemudian), tidak
  // ada komponen manapun yang butuh state ter-refresh SEBELUM action-nya sendiri selesai (tidak
  // ada pemanggilan `useMrpStore.getState()` sinkron setelah `await store.xxxAction(...)` di
  // seluruh components/app -- polanya selalu subscription `useMrpStore((s) => s.x)`).
  function backgroundRefresh() {
    get()
      .refresh()
      .catch((err) => console.warn("[mrp-store] background refresh gagal:", err));
  }

  return withBusyTracking(set, {
  ...emptyState,

  hydrate: (snapshot) => set({ ...snapshot, hydrated: true }),
  refresh: async () => {
    const { busy: _snapshotBusy, ...snapshot } = await actions.getFlowSnapshotAction();
    // `busy` SENGAJA tidak ikut di-spread -- ini flag UI lokal punya store.ts (lihat
    // withBusyTracking), bukan bagian data server; overwrite balik pakai kosong/false dari sini
    // akan salah kalau ada action LAIN yang kebetulan masih berjalan bersamaan.
    set({ ...snapshot, hydrated: true });
  },

  importMrp: async (parsed, customId) => {
    const id = await actions.importMrpAction(parsed, customId);
    backgroundRefresh();
    return id;
  },
  // PERFORMA: optimistic PATCH SEBELUM tulisnya selesai (bukan sesudah, beda dari
  // updateBatchToCutting) -- dropdown "Vendor Material" di Procurement langsung pindah nilai
  // seketika diklik, tidak nunggu round-trip server sama sekali. Aman: kalau tulisnya GAGAL,
  // state di-ROLLBACK ke sebelum klik + user diberi tahu lewat alert, jadi tidak pernah ada
  // kondisi UI bilang "sudah tersimpan" padahal database-nya beda (lihat juga markRollArrived
  // di bawah, pola yang sama).
  assignMaterialSupplier: async (mrpId, materialRowIds, supplier) => {
    const previous = get().mrpDetails;
    set({
      mrpDetails: previous.map((d) =>
        d.mrp.id !== mrpId ? d : { ...d, materialRows: d.materialRows.map((r) => (materialRowIds.includes(r.id) ? { ...r, supplier } : r)) }
      ),
    });
    try {
      await actions.assignMaterialSupplierAction(mrpId, materialRowIds, supplier);
    } catch (err) {
      set({ mrpDetails: previous });
      window.alert("Gagal menyimpan pilihan vendor material -- perubahan dibatalkan. " + (err instanceof Error ? err.message : String(err)));
      throw err;
    }
    backgroundRefresh();
  },
  assignMaterialEntitas: async (mrpId, materialRowId, entitas) => {
    await actions.assignMaterialEntitasAction(mrpId, materialRowId, entitas);
    backgroundRefresh();
  },
  switchAduanVendor: async (mrpId, aduanId, toVendor) => {
    await actions.switchAduanVendorAction(mrpId, aduanId, toVendor);
    backgroundRefresh();
  },
  approvePpicMrp: async (mrpId) => {
    await actions.approvePpicMrpAction(mrpId);
    backgroundRefresh();
  },
  rejectPpicMrp: async (mrpId, reason) => {
    await actions.rejectPpicMrpAction(mrpId, reason);
    backgroundRefresh();
  },
  sendPoToFinance: async (mrpId) => {
    await actions.sendPoToFinanceAction(mrpId);
    backgroundRefresh();
  },
  approveMaterialPo: async (id) => {
    await actions.approveMaterialPoAction(id);
    backgroundRefresh();
  },
  approveMaklonPo: async (id) => {
    await actions.approveMaklonPoAction(id);
    backgroundRefresh();
  },
  bookInvoice: async (poId, input) => {
    await actions.bookInvoiceAction(poId, input);
    backgroundRefresh();
  },
  setInvoicesPaid: async (invoiceIds, paid) => {
    await actions.setInvoicesPaidAction(invoiceIds, paid);
    backgroundRefresh();
  },
  setInvoicePaymentProof: async (invoiceIds, dataUrl, fileName) => {
    await actions.setInvoicePaymentProofAction(invoiceIds, dataUrl, fileName);
    backgroundRefresh();
  },
  setInvoicesDelivery: async (invoiceIds, deliveryDate) => {
    await actions.setInvoicesDeliveryAction(invoiceIds, deliveryDate);
    backgroundRefresh();
  },
  // Optimistic PATCH sebelum tulisnya selesai (sama seperti assignMaterialSupplier di atas) --
  // "Tandai diterima" langsung ganti jadi pill "Diterima" seketika diklik. status/receivedAt
  // invoice dihitung persis logika server-nya (markRollArrivedAction: DELIVERY -> RECEIVING,
  // receivedAt cuma diisi kalau belum ada) supaya tidak menyimpang dari yang bakal ditulis.
  // Rollback + alert kalau tulisnya gagal.
  markRollArrived: async (invoiceId, warna, lengan, rollIndex, codeRoll, codeLot) => {
    const colorKey = `${warna}|${lengan}`;
    const arrivedAt = localDateString(new Date());
    const previous = get().invoices;
    set({
      invoices: previous.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        const arr = [...(inv.rollArrivals[colorKey] ?? [])];
        arr[rollIndex] = { arrivedAt, codeRoll, codeLot };
        return {
          ...inv,
          rollArrivals: { ...inv.rollArrivals, [colorKey]: arr },
          status: inv.status === "DELIVERY" ? "RECEIVING" : inv.status,
          receivedAt: inv.receivedAt ?? arrivedAt,
        };
      }),
    });
    try {
      await actions.markRollArrivedAction(invoiceId, warna, lengan, rollIndex, codeRoll, codeLot);
    } catch (err) {
      set({ invoices: previous });
      window.alert("Gagal menandai roll diterima -- perubahan dibatalkan. " + (err instanceof Error ? err.message : String(err)));
      throw err;
    }
    backgroundRefresh();
  },
  receiveRawMaterialRoll: async (invoiceId, warna, lengan, rollIndex, netKg, claim, codeRoll, photo) => {
    await actions.receiveRawMaterialRollAction(invoiceId, warna, lengan, rollIndex, netKg, claim, codeRoll, photo);
    backgroundRefresh();
  },
  confirmRollWeigh: async (items) => {
    const result = await actions.confirmRollWeighAction(items);
    backgroundRefresh();
    return result;
  },
  startProductionBatch: async (input) => {
    await actions.startProductionBatchAction(input);
    backgroundRefresh();
  },
  submitProductionResult: async (input) => {
    await actions.submitProductionResultAction(input);
    backgroundRefresh();
  },
  createDeliveryKoli: async (input) => {
    await actions.createDeliveryKoliAction(input);
    backgroundRefresh();
  },
  setKoliWeight: async (koliId, beratKoli) => {
    await actions.setKoliWeightAction(koliId, beratKoli);
    backgroundRefresh();
  },
  markKoliDelivered: async (koliId) => {
    await actions.markKoliDeliveredAction(koliId);
    backgroundRefresh();
  },
  createVendorInvoice: async (input) => {
    await actions.createVendorInvoiceAction(input);
    backgroundRefresh();
  },
  setVendorInvoiceStatus: async (invoiceId, status) => {
    await actions.setVendorInvoiceStatusAction(invoiceId, status);
    backgroundRefresh();
  },
  addVendorInvoiceAdjustment: async (invoiceId, input) => {
    await actions.addVendorInvoiceAdjustmentAction(invoiceId, input);
    backgroundRefresh();
  },
  payVendorInvoice: async (invoiceId) => {
    await actions.payVendorInvoiceAction(invoiceId);
    backgroundRefresh();
  },
  markNotificationRead: async (id) => {
    await actions.markNotificationReadAction(id);
    backgroundRefresh();
  },
  markAllNotificationsRead: async (ids) => {
    await actions.markAllNotificationsReadAction(ids);
    backgroundRefresh();
  },
  dismissNotification: async (id) => {
    await actions.dismissNotificationAction(id);
    backgroundRefresh();
  },

  addHargaMaklonRow: async () => {
    await actions.addHargaMaklonRowAction();
    backgroundRefresh();
  },
  updateHargaMaklonRow: async (id, patch) => {
    await actions.updateHargaMaklonRowAction(id, patch);
    backgroundRefresh();
  },
  deleteHargaMaklonRow: async (id) => {
    await actions.deleteHargaMaklonRowAction(id);
    backgroundRefresh();
  },
  replaceHargaMaklon: async (rows) => {
    await actions.replaceHargaMaklonAction(rows);
    backgroundRefresh();
  },
  addHargaKainRow: async () => {
    await actions.addHargaKainRowAction();
    backgroundRefresh();
  },
  updateHargaKainRow: async (id, patch) => {
    await actions.updateHargaKainRowAction(id, patch);
    backgroundRefresh();
  },
  deleteHargaKainRow: async (id) => {
    await actions.deleteHargaKainRowAction(id);
    backgroundRefresh();
  },
  replaceHargaKain: async (rows) => {
    await actions.replaceHargaKainAction(rows);
    backgroundRefresh();
  },
  addHargaKainPksRow: async () => {
    await actions.addHargaKainPksRowAction();
    backgroundRefresh();
  },
  updateHargaKainPksRow: async (id, patch) => {
    await actions.updateHargaKainPksRowAction(id, patch);
    backgroundRefresh();
  },
  deleteHargaKainPksRow: async (id) => {
    await actions.deleteHargaKainPksRowAction(id);
    backgroundRefresh();
  },
  replaceHargaKainPks: async (rows) => {
    await actions.replaceHargaKainPksAction(rows);
    backgroundRefresh();
  },
  addEntitas: async (nama) => {
    await actions.addEntitasAction(nama);
    backgroundRefresh();
  },
  updateEntitas: async (id, nama) => {
    await actions.updateEntitasAction(id, nama);
    backgroundRefresh();
  },
  deleteEntitas: async (id) => {
    await actions.deleteEntitasAction(id);
    backgroundRefresh();
  },
  replaceEntitas: async (rows) => {
    await actions.replaceEntitasAction(rows);
    backgroundRefresh();
  },
  addSupplier: async (nama) => {
    await actions.addSupplierAction(nama);
    backgroundRefresh();
  },
  updateSupplier: async (id, nama) => {
    await actions.updateSupplierAction(id, nama);
    backgroundRefresh();
  },
  deleteSupplier: async (id) => {
    await actions.deleteSupplierAction(id);
    backgroundRefresh();
  },
  replaceSupplier: async (rows) => {
    await actions.replaceSupplierAction(rows);
    backgroundRefresh();
  },

  setMaterialPoEntity: async (poId, entitas) => {
    await actions.setMaterialPoEntityAction(poId, entitas);
    backgroundRefresh();
  },
  setMaterialPoColorEntity: async (poId, warna, lengan, entitas) => {
    await actions.setMaterialPoColorEntityAction(poId, warna, lengan, entitas);
    backgroundRefresh();
  },
  approveAllMaterialPos: async () => {
    await actions.approveAllMaterialPosAction();
    backgroundRefresh();
  },
  approveVendorMaterialPos: async (mrpId, vendor) => {
    await actions.approveVendorMaterialPosAction(mrpId, vendor);
    backgroundRefresh();
  },
  closePoWithReason: async (poId, reason, warna, lengan, closeQty) => {
    await actions.closePoWithReasonAction(poId, reason, warna, lengan, closeQty);
    backgroundRefresh();
  },
  reassignMaterialToSupplier: async (poId, warna, lengan, moveQty, newSupplier, reason) => {
    await actions.reassignMaterialToSupplierAction(poId, warna, lengan, moveQty, newSupplier, reason);
    backgroundRefresh();
  },
  transferMaterial: async (items, toVendor, deliveryDate) => {
    await actions.transferMaterialAction(items, toVendor, deliveryDate);
    backgroundRefresh();
  },
  advanceMaklonProduction: async (id) => {
    await actions.advanceMaklonProductionAction(id);
    backgroundRefresh();
  },
  submitMaklonInvoice: async () => {}, // sudah no-op sejak sebelum migrasi (jalur ditutup, lihat lib/mrp/actions.ts)
  approveMaklonInvoice: async (invoiceId) => {
    await actions.approveMaklonInvoiceAction(invoiceId);
    backgroundRefresh();
  },
  payMaklonInvoice: async (invoiceId) => {
    await actions.payMaklonInvoiceAction(invoiceId);
    backgroundRefresh();
  },
  receiveRawMaterialAddBuy: async (invoiceId, addBuyId) => {
    await actions.receiveRawMaterialAddBuyAction(invoiceId, addBuyId);
    backgroundRefresh();
  },
  updateBatchToCutting: async (batchId, cuttingAt, sizeQty) => {
    const result = await actions.updateBatchToCuttingAction(batchId, cuttingAt, sizeQty);
    // Optimistic PATCH lokal -- baris roll ini di tabel Cutting berubah jadi "sudah cutting"
    // SEKETIKA (tidak nunggu backgroundRefresh snapshot penuh), langsung dari hasil tulis di
    // atas. Kasus nyata yang diminta: 10 roll di-"Update ke Cutting" satu-satu, tiap klik harus
    // kerasa instan, bukan nunggu ~1 detik+ snapshot ulang cuma buat lihat 1 baris berubah.
    set({
      productionBatches: get().productionBatches.map((b) => (b.id === batchId ? { ...b, cuttingAt: result.cuttingAt, sizeQty: result.sizeQty ?? b.sizeQty } : b)),
    });
    backgroundRefresh();
  },
  resolveProductionYield: async (batchId, note) => {
    await actions.resolveProductionYieldAction(batchId, note);
    backgroundRefresh();
  },
  unresolveProductionYield: async (batchId) => {
    await actions.unresolveProductionYieldAction(batchId);
    backgroundRefresh();
  },
  reworkRejectSize: async (input) => {
    await actions.reworkRejectSizeAction(input);
    backgroundRefresh();
  },
  updateDeliveryKoli: async (koliId, patch) => {
    await actions.updateDeliveryKoliAction(koliId, patch);
    backgroundRefresh();
  },
  setVendorInvoiceDueDate: async (invoiceId, dueDate) => {
    await actions.setVendorInvoiceDueDateAction(invoiceId, dueDate);
    backgroundRefresh();
  },
  setVendorInvoiceOngkir: async (invoiceId, ongkirTotal) => {
    await actions.setVendorInvoiceOngkirAction(invoiceId, ongkirTotal);
    backgroundRefresh();
  },
  confirmFgDone: async (groupKey, mrpId, vendorProduksi, warna, lengan) => {
    await actions.confirmFgDoneAction(groupKey, mrpId, vendorProduksi, warna, lengan);
    backgroundRefresh();
  },
  undoFgConfirm: async (groupKey) => {
    await actions.undoFgConfirmAction(groupKey);
    backgroundRefresh();
  },
  markProductionGroupDone: async (groupKey, mrpId, vendorProduksi, warna, lengan) => {
    await actions.markProductionGroupDoneAction(groupKey, mrpId, vendorProduksi, warna, lengan);
    backgroundRefresh();
  },
  undoProductionGroupDone: async (groupKey) => {
    await actions.undoProductionGroupDoneAction(groupKey);
    backgroundRefresh();
  },
  closeProductionPo: async (maklonPoId, reason) => {
    await actions.closeProductionPoAction(maklonPoId, reason);
    backgroundRefresh();
  },
  reopenProductionPo: async (maklonPoId) => {
    await actions.reopenProductionPoAction(maklonPoId);
    backgroundRefresh();
  },
  setRejectRemark: async (poId, remark) => {
    await actions.setRejectRemarkAction(poId, remark);
    backgroundRefresh();
  },
  resolveMaterialClaim: async (key, note) => {
    await actions.resolveMaterialClaimAction(key, note);
    backgroundRefresh();
  },
  unresolveMaterialClaim: async (key) => {
    await actions.unresolveMaterialClaimAction(key);
    backgroundRefresh();
  },
  requestMaterialClaimRetur: async (key, note) => {
    await actions.requestMaterialClaimReturAction(key, note);
    backgroundRefresh();
  },
  cancelMaterialClaimReturRequest: async (key) => {
    await actions.cancelMaterialClaimReturRequestAction(key);
    backgroundRefresh();
  },
  markMaterialClaimReturDelivered: async (key, note) => {
    await actions.markMaterialClaimReturDeliveredAction(key, note);
    backgroundRefresh();
  },
  confirmMaterialClaimReturReceived: async (key) => {
    await actions.confirmMaterialClaimReturReceivedAction(key);
    backgroundRefresh();
  },
  resetAll: async () => {
    await actions.resetAllAction();
    backgroundRefresh();
  },
  });
});
