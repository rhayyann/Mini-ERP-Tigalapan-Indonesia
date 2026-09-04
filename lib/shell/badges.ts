import {
  availableFgToShip,
  cumulativeSizeQtyForGroup,
  cutWarnaLenganGroups,
  cuttingSizesForGroup,
  invoiceableMrpIdsFullQty,
  invoiceFullyArrived,
  maklonPoInvoiceLockedBy,
  materialClaimsList,
  mrpIdsWithRemainingReject,
  mrpIdsWithUnpackedFg,
  pendingWeighRollsCount,
  productionYieldAlertsList,
  warnaLenganGroupsWithFg,
} from "@/lib/mrp/derive";
import type { MrpDetail } from "@/lib/mrp/store";
import type { DeliveryKoli, MaklonInvoice, MaklonPO, MaterialPO, ProductionBatch, ProductionGroupMeta, ProductionResult, ProductionYieldResolution, RawMaterialInvoice, ShippableKind, VendorInvoice } from "@/lib/mrp/types";

/** Minimal shape yang dibutuhkan dari `MrpDetail` — dideklarasikan lokal (bukan import
 *  dari lib/mrp/store) supaya lib/shell tidak bergantung ke store, cukup ke bentuk datanya. */
type MrpPoSentShape = { poSent: boolean; ppicApproval: string };

/** Helper murni untuk menghitung badge count "item pending yang butuh aksi user" per
 *  menu/sub-tab — dihitung langsung dari data store (bukan dari `notifications[]`).
 *  Definisi "pending" di sini konsisten dengan logic existing di tiap halaman terkait. */

// Item 3 (feedback batch 2026-09-05): marker teks polos di label <option> dropdown "pilih MRP" --
// SEMUA 8 call site di bawah pakai <select><option> NATIF (tidak ada komponen dropdown custom di
// file-file itu), jadi badge/pill JSX tidak mungkin dipasang di sana (browser strip apa pun
// selain teks di dalam <option>). n<=0 -> string kosong (tidak menambah apa pun ke label).
export function pendingMarker(n: number, noun = "belum selesai"): string {
  return n > 0 ? ` — ⚠ ${n} ${noun}` : "";
}

export function countPendingMaterialPO(materialPOs: MaterialPO[]): number {
  return materialPOs.filter((p) => p.status !== "CANCELLED" && !p.approved).length;
}

/** Item 3.2 — scoping 1 MRP dari countPendingMaterialPO di atas, dipakai marker dropdown "pilih
 *  MRP" di components/finance/po-material-panel.tsx. */
export function countPendingMaterialPoForMrp(mrpId: string, materialPOs: MaterialPO[]): number {
  return materialPOs.filter((p) => p.mrpId === mrpId && p.status !== "CANCELLED" && !p.approved).length;
}

export function countPendingMaklonPO(maklonPOs: MaklonPO[]): number {
  return maklonPOs.filter((p) => !p.approved).length;
}

export function countPoApprovalTotal(materialPOs: MaterialPO[], maklonPOs: MaklonPO[]): number {
  return countPendingMaterialPO(materialPOs) + countPendingMaklonPO(maklonPOs);
}

export function countPaymentMaterialReady(invoices: RawMaterialInvoice[]): number {
  return invoices.filter((i) => i.status === "INVOICED").length;
}

export function countPaymentMaklonReady(vendorInvoices: VendorInvoice[]): number {
  return vendorInvoices.filter((i) => i.status === "APPROVED").length;
}

export function countPaymentTotal(invoices: RawMaterialInvoice[], vendorInvoices: VendorInvoice[]): number {
  return countPaymentMaterialReady(invoices) + countPaymentMaklonReady(vendorInvoices);
}

/** MRP yang SUDAH disetujui SCM tapi belum dibuatkan PO -- HARUS konsisten dengan filter
 *  `selectable` di app/procurement/po-approval/page.tsx (dulu badge ini cuma cek `!poSent`,
 *  jadi ikut menghitung MRP yang masih menunggu approval SCM / ditolak, padahal MRP itu belum
 *  bisa dipilih sama sekali di dropdown halaman itu -- badge jadi nyala tanpa ada yang bisa
 *  ditindaklanjuti). */
export function countMrpWithoutPO(mrpDetails: MrpPoSentShape[]): number {
  return mrpDetails.filter((d) => !d.poSent && d.ppicApproval === "PPIC_APPROVED").length;
}

/** Item 3.2 — bukan scoping dari countMrpWithoutPO di atas (beda dimensi: itu MENGHITUNG MRP,
 *  ini menghitung baris material TANPA vendor DI DALAM satu MRP) tapi predikat yang sama persis
 *  dengan gate nyata "Kirim PO ke Finance" di halaman itu (`allMaterialAssigned`,
 *  app/procurement/po-approval/page.tsx) — inilah yang benar-benar memblokir MRP itu di sini. */
export function countMaterialRowsWithoutSupplierForMrp(detail: Pick<MrpDetail, "materialRows">): number {
  return detail.materialRows.filter((m) => !m.supplier).length;
}

/** MRP dari PPIC yang masih menunggu approval SCM sebelum boleh diproses Procurement — badge
 *  menu "Approval MRP" di role SCM (lihat ppicApproval di lib/mrp/store.ts). */
export function countMrpAwaitingScmApproval(mrpDetails: { ppicApproval: string }[]): number {
  return mrpDetails.filter((d) => d.ppicApproval === "WAITING_PPIC_APPROVAL").length;
}

/** PO material yang sudah disetujui Finance tapi masih ada sisa roll belum diinvoice —
 *  konsisten dengan `openPOs` di halaman Paying Voucher (Invoice). */
export function countMaterialPOsAwaitingInvoice(materialPOs: MaterialPO[]): number {
  return materialPOs.filter((po) => po.status !== "CANCELLED" && po.approved && po.invoicedRolls < po.rollCount).length;
}

/** Invoice vendor produksi yang baru disubmit vendor, menunggu direview Procurement. */
export function countVendorInvoicesAwaitingReview(vendorInvoices: VendorInvoice[]): number {
  return vendorInvoices.filter((i) => i.status === "SUBMITTED").length;
}

/** Invoice maklon yang menunggu approval Finance. */
export function countMaklonInvoicesAwaitingApproval(maklonInvoices: MaklonInvoice[]): number {
  return maklonInvoices.filter((i) => i.status === "SUBMITTED").length;
}

/** Invoice material yang sudah dibayar Finance (PAID) tapi belum di-set tanggal delivery-nya
 *  oleh Procurement — inilah yang memunculkan tombol "Set Delivery" di Material Tracking. */
export function countMaterialInvoicesReadyForDelivery(invoices: RawMaterialInvoice[]): number {
  return invoices.filter((i) => i.status === "PAID" && !i.deliveredAt).length;
}

/** Klaim selisih berat (di luar toleransi) yang belum ditindaklanjuti Procurement — lihat
 *  halaman Klaim Material. */
export function countMaterialClaimsUnresolved(invoices: RawMaterialInvoice[], resolutions: Record<string, unknown>): number {
  return materialClaimsList(invoices).filter((c) => !resolutions[c.key]).length;
}

// ---- Vendor Produksi (portal eksternal) --------------------------------------------------

/** MRP/batch yang butuh aksi di halaman Produksi (tab Cutting & Reject — FG/Rework murni
 *  entri progres berkelanjutan, tidak dihitung supaya badge tidak nyala terus-menerus selama
 *  produksi berjalan normal):
 *  - Roll yang sudah diterima (Good Receive) tapi belum ditimbang di Cutting (belum jadi batch
 *    sama sekali, jadi tidak kelihatan dari productionBatches — lihat pendingWeighRollsCount).
 *  - Batch yang sudah masuk masa resting tapi belum di-"Update ke Cutting" (aksi nyata di tab Cutting).
 *  - MRP dengan sisa reject yang belum di-rework (aksi nyata di tab Reject/Rework). */
export function countVendorProduksiActionable(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  invoices: RawMaterialInvoice[]
): number {
  const awaitingWeigh = pendingWeighRollsCount(vendorId, invoices, productionBatches);
  const awaitingCuttingUpdate = productionBatches.filter((b) => b.vendorProduksi === vendorId && !b.cuttingAt).length;
  const mrpWithRemainingReject = mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults).length;
  return awaitingWeigh + awaitingCuttingUpdate + mrpWithRemainingReject;
}

/** Roll yang sudah diterima tapi belum ditimbang, plus batch yang sudah masuk masa resting
 *  tapi belum di-"Update ke Cutting" — badge tab Cutting. */
export function countCuttingAwaitingUpdate(vendorId: string, productionBatches: ProductionBatch[], invoices: RawMaterialInvoice[]): number {
  const awaitingWeigh = pendingWeighRollsCount(vendorId, invoices, productionBatches);
  const awaitingCuttingUpdate = productionBatches.filter((b) => b.vendorProduksi === vendorId && !b.cuttingAt).length;
  return awaitingWeigh + awaitingCuttingUpdate;
}

/** Item 3.2 — scoping 1 MRP dari countCuttingAwaitingUpdate di atas, dipakai marker dropdown
 *  "pilih MRP" di components/mrp/production-cutting-tab.tsx. **Post-Tester-round-1 fix:** harus
 *  pakai `pendingWeighRollsCount(vendorId, invoices, productionBatches, mrpId)` (di-scope lewat
 *  parameter `mrpId` baru), BUKAN `pendingWeighRolls(...).length` — yang terakhir cuma menghitung
 *  roll yang belum pernah ditimbang/lagi diklaim, dan salah melewatkan roll "sudah ditimbang tapi
 *  belum dikonfirmasi" yang justru dihitung oleh `countCuttingAwaitingUpdate` di atas. Dengan
 *  bug lama, badge tab bisa nyala (mis. 1) sementara marker dropdown untuk MRP yang sama diam
 *  di 0. */
export function countCuttingAwaitingUpdateForMrp(mrpId: string, vendorId: string, productionBatches: ProductionBatch[], invoices: RawMaterialInvoice[]): number {
  const awaitingWeigh = pendingWeighRollsCount(vendorId, invoices, productionBatches, mrpId);
  const awaitingCuttingUpdate = productionBatches.filter((b) => b.mrpId === mrpId && b.vendorProduksi === vendorId && !b.cuttingAt).length;
  return awaitingWeigh + awaitingCuttingUpdate;
}

/** Warna/lengan yang sudah tercutting tapi belum ditandai "Done Produksi" — masih terbuka untuk
 *  input Finish Good/Reject. Dipakai badge tab Finish Good & Reject (sinyal sama: kedua tab itu
 *  aksinya sama-sama "input data produksi" selama grup belum ditutup). */
type GroupGap = { groupKey: string; totalTarget: number; totalFg: number; sisaReject: number; fgConfirmed: boolean; done: boolean };

function productionGroupGaps(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[],
  // Item 3: filter opsional supaya versi per-MRP (dipakai marker "belum selesai" di dropdown
  // "pilih MRP") bisa REUSE fungsi ini langsung alih-alih menduplikasi loopnya -- kalau di-isi,
  // cuma MRP itu yang dihitung (bukan semua MRP milik vendor).
  onlyMrpId?: string
): GroupGap[] {
  const mrpIds = Array.from(new Set(productionBatches.filter((b) => b.vendorProduksi === vendorId && b.cuttingAt && (!onlyMrpId || b.mrpId === onlyMrpId)).map((b) => b.mrpId)));
  const out: GroupGap[] = [];
  for (const mrpId of mrpIds) {
    for (const g of warnaLenganGroupsWithFg(mrpId, vendorId, productionBatches, productionResults)) {
      const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
      // Target dari hasil CUTTING AKTUAL (bukan rencana MRP) -- konsisten dengan
      // production-result-panel.tsx & confirmFgDoneAction, supaya badge ini tidak ikut
      // menghitung selisih rencana-vs-cutting sebagai "kekurangan Finish Good" yang sebetulnya
      // bukan (lihat catatan di cuttingSizesForGroup, lib/mrp/derive.ts).
      const target = cuttingSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, productionBatches);
      const totalTarget = Object.values(target).reduce((a, b) => a + b, 0);
      const totalFg = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", productionResults)).reduce((a, b) => a + b, 0);
      const sisaReject = Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults)).reduce((a, b) => a + b, 0);
      const meta = productionGroupMeta.find((m) => m.groupKey === groupKey);
      out.push({ groupKey, totalTarget, totalFg, sisaReject, fgConfirmed: !!meta?.fgConfirmedAt, done: !!meta?.doneAt });
    }
  }
  return out;
}

/** Warna/lengan yang Finish Good-nya belum menutup seluruh target cutting DAN belum "Selesai
 *  Produksi" (tahap 1, tab Finish Good) — badge tab Finish Good. Begitu fg-confirmed, tidak ada
 *  lagi yang bisa diinput di tab ini, jadi badge berhenti nyala meski masih ada selisih (itu
 *  sudah jadi tanggung jawab reject/rework). */
export function countFgShortfallGroups(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails).filter((g) => !g.fgConfirmed && g.totalFg < g.totalTarget).length;
}

/** Item 3.2 — scoping 1 MRP dari countFgShortfallGroups di atas, dipakai marker dropdown "pilih
 *  MRP" (kind="FG") di components/mrp/production-result-panel.tsx. */
export function countFgShortfallGroupsForMrp(
  mrpId: string,
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails, mrpId).filter((g) => !g.fgConfirmed && g.totalFg < g.totalTarget).length;
}

/** Badge tab Reject — nyala begitu grup sudah "Selesai Produksi" di tab Finish Good (fg-confirmed,
 *  reject-nya baru benar-benar dihitung & tersimpan di titik itu -- lihat confirmFgDoneAction)
 *  DAN masih ada sisa reject yang belum dirework/dibuang ke sisa. Sebelum fg-confirmed, belum ada
 *  dasar bilang "reject perlu ditindak" -- angkanya belum tersimpan sama sekali. */
export function countRejectActionableGroups(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails).filter((g) => g.fgConfirmed && g.sisaReject > 0).length;
}

/** Item 3.2 — scoping 1 MRP dari countRejectActionableGroups di atas, dipakai marker dropdown
 *  "pilih MRP" (kind="REJECT") di components/mrp/production-result-panel.tsx. */
export function countRejectActionableGroupsForMrp(
  mrpId: string,
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails, mrpId).filter((g) => g.fgConfirmed && g.sisaReject > 0).length;
}

/** Roll dengan alert yield <99% yang belum ditindaklanjuti — badge menu Yield Alert (portal
 *  internal Produksi). */
export function countProductionYieldUnresolved(
  productionBatches: ProductionBatch[],
  mrpDetails: MrpDetail[],
  productionYieldResolutions: Record<string, ProductionYieldResolution>
): number {
  return productionYieldAlertsList(productionBatches, mrpDetails, productionYieldResolutions).filter((r) => !r.resolved).length;
}

/** MRP dengan sisa reject yang belum di-rework — badge tab Rework. */
export function countRemainingRework(vendorId: string, productionBatches: ProductionBatch[], productionResults: ProductionResult[]): number {
  return mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults).length;
}

/** Item 3.2 — scoping 1 MRP dari countRemainingRework di atas, dipakai marker dropdown "pilih
 *  MRP" di components/mrp/production-rework-tab.tsx. Beda unit dari counterpart-nya: di sini
 *  dihitung PER warna/lengan yang masih ada sisa reject (bukan per-MRP), sama dengan test di
 *  dalam mrpIdsWithRemainingReject (lihat lib/mrp/derive.ts). */
export function countRemainingRejectGroupsForMrp(mrpId: string, vendorId: string, productionBatches: ProductionBatch[], productionResults: ProductionResult[]): number {
  return cutWarnaLenganGroups(mrpId, vendorId, productionBatches).filter((g) => {
    const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
    const sisaReject = Object.values(cumulativeSizeQtyForGroup(groupKey, "REJECT", productionResults)).reduce((a, b) => a + b, 0);
    return sisaReject > 0;
  }).length;
}

/** Warna/lengan yang sudah "Selesai Produksi" di tab Finish Good (tahap 1, fg-confirmed) tapi
 *  belum ditandai "Selesai Produksi" di tab Final Produksi (tahap 2, final lock) — badge tab
 *  Final Produksi, sinyal "siap direview & ditutup final, tinggal Anda konfirmasi (rework dulu
 *  kalau masih perlu)". */
export function countProductionFinalReady(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails).filter((g) => g.fgConfirmed && !g.done).length;
}

/** Item 3.2 — scoping 1 MRP dari countProductionFinalReady di atas, dipakai marker dropdown
 *  "pilih MRP" di components/mrp/production-final-tab.tsx. */
export function countProductionFinalReadyForMrp(
  mrpId: string,
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails, mrpId).filter((g) => g.fgConfirmed && !g.done).length;
}

/** Invoice raw material yang masih ada roll/add-buy belum ditandai diterima di halaman Good
 *  Receive (sekarang cuma tanggung jawab "tandai diterima" — menimbang pindah ke Cutting). Tidak
 *  cukup cek `status === "RECEIVING"` — status itu cuma berubah sekali saat roll pertama ditandai
 *  diterima dan tidak pernah balik lagi walau semua roll sudah lengkap (lihat
 *  `invoiceFullyArrived`), jadi badge harus cek kelengkapan asli datanya. */
export function countVendorGoodReceiveEligible(vendorId: string, invoices: RawMaterialInvoice[]): number {
  return invoices.filter(
    (i) => i.destinationVendor === vendorId && (i.status === "DELIVERY" || i.status === "RECEIVING") && !invoiceFullyArrived(i)
  ).length;
}

/** Item 3.2 — scoping 1 MRP dari countVendorGoodReceiveEligible di atas, dipakai marker dropdown
 *  "pilih MRP" di app/vendor-maklon/receiving/page.tsx. Unit = PO/invoice. */
export function countGoodReceiveEligibleForMrp(mrpId: string, vendorId: string, invoices: RawMaterialInvoice[]): number {
  return invoices.filter(
    (i) => i.mrpId === mrpId && i.destinationVendor === vendorId && (i.status === "DELIVERY" || i.status === "RECEIVING") && !invoiceFullyArrived(i)
  ).length;
}

/** MRP dengan hasil produksi (FG/rework -- item 20: Reject bukan lagi shippable) yang belum
 *  dikemas ke koli pengiriman -- hanya menghitung warna/lengan yang sudah tahap 1 "Selesai
 *  Produksi" (fgConfirmedAt) DAN PO Produksinya belum di-Close (item 21/22, lihat gate di
 *  availableFgToShip). Tahap 2 (doneAt/Final Produksi) TIDAK lagi jadi syarat di sini. */
export function countVendorPengirimanReady(
  vendorId: string,
  productionResults: ProductionResult[],
  deliveryKolis: DeliveryKoli[],
  productionGroupMeta: ProductionGroupMeta[],
  maklonPOs: MaklonPO[]
): number {
  return mrpIdsWithUnpackedFg(vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs).length;
}

// Item 20: Reject bukan lagi shippable -- source cuma FG & REWORK, sama seperti mrpIdsWithUnpackedFg.
const SHIPPABLE_SOURCES: ShippableKind[] = ["FG", "REWORK"];

/** Item 3.2 — beda dari countVendorPengirimanReady di atas (yang cuma MENGHITUNG MRP), ini
 *  menjumlahkan PCS yang masih belum dikemas untuk SATU MRP, dipakai marker dropdown "pilih MRP"
 *  di app/vendor-maklon/pengiriman/page.tsx. Unit = pcs (beda dari counterpart-nya yang unitnya
 *  "MRP"), supaya marker-nya informatif ("berapa banyak" bukan cuma "MRP ini punya sisa"). */
export function countPengirimanPendingForMrp(
  mrpId: string,
  vendorId: string,
  productionResults: ProductionResult[],
  deliveryKolis: DeliveryKoli[],
  productionGroupMeta: ProductionGroupMeta[],
  maklonPOs: MaklonPO[]
): number {
  return SHIPPABLE_SOURCES.reduce((sum, source) => {
    const rows = availableFgToShip(mrpId, vendorId, productionResults, deliveryKolis, productionGroupMeta, maklonPOs, undefined, source);
    return sum + rows.reduce((s, r) => s + r.available, 0);
  }, 0);
}

/** MRP yang sudah delivered tapi masih ada qty belum diinvoice — siap diajukan di sub-tab
 *  "Invoice Vendor" (per pcs). Dedupe per MRP (bukan per baris warna/lengan) supaya angkanya
 *  masuk akal sebagai "jumlah MRP yang perlu dicek", konsisten dengan gaya badge lain. MRP yang
 *  sudah terkunci ke jalur Invoice Maklon (lihat `maklonPoInvoiceLockedBy`) dikecualikan —
 *  jalur ini sudah tidak bisa dipakai lagi untuk MRP itu, jadi tidak masuk hitungan "perlu dicek". */
export function countVendorInvoiceableMrp(
  vendorId: string,
  mrpDetails: MrpDetail[],
  deliveryKolis: DeliveryKoli[],
  vendorInvoices: VendorInvoice[],
  maklonInvoices: MaklonInvoice[]
): number {
  const lines = invoiceableMrpIdsFullQty(vendorId, mrpDetails, deliveryKolis, vendorInvoices).filter(
    (l) => maklonPoInvoiceLockedBy(l.mrpId, vendorId, maklonInvoices, vendorInvoices) !== "maklon"
  );
  return new Set(lines.map((l) => l.mrpId)).size;
}

/** DEPRECATED — jalur Invoice Maklon (per-PO) sudah ditutup untuk pengajuan baru (konsolidasi
 *  ke Invoice Vendor per-pcs, lihat submitMaklonInvoice di lib/mrp/store.ts), jadi tidak ada
 *  lagi PO yang "siap diajukan" lewat jalur ini — selalu 0. Fungsi ini dipertahankan (bukan
 *  dihapus) supaya pemanggil lama tidak perlu diubah lagi kalau nanti dibutuhkan lagi. */
export function countVendorMaklonInvoiceReady(): number {
  return 0;
}

/** Total badge untuk halaman gabungan Invoice & Payment. Cuma sub-tab Invoice Vendor yang
 *  masih punya aksi nyata (submit invoice) — Invoice Maklon sekarang murni arsip, jadi tidak
 *  ikut disumbangkan ke total ini lagi. */
export function countVendorInvoicePaymentTotal(
  vendorId: string,
  mrpDetails: MrpDetail[],
  deliveryKolis: DeliveryKoli[],
  vendorInvoices: VendorInvoice[],
  maklonInvoices: MaklonInvoice[]
): number {
  return countVendorInvoiceableMrp(vendorId, mrpDetails, deliveryKolis, vendorInvoices, maklonInvoices);
}
