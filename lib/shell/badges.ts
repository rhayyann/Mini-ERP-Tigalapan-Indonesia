import {
  cumulativeSizeQtyForGroup,
  cutWarnaLenganGroups,
  invoiceableMrpIdsFullQty,
  invoiceFullyReceived,
  maklonPoInvoiceLockedBy,
  materialClaimsList,
  mrpIdsWithRemainingReject,
  mrpIdsWithUnpackedFg,
  targetSizesForGroup,
} from "@/lib/mrp/derive";
import type { MrpDetail } from "@/lib/mrp/store";
import type { DeliveryKoli, MaklonInvoice, MaklonPO, MaterialPO, ProductionBatch, ProductionGroupMeta, ProductionResult, RawMaterialInvoice, VendorInvoice } from "@/lib/mrp/types";

/** Minimal shape yang dibutuhkan dari `MrpDetail` — dideklarasikan lokal (bukan import
 *  dari lib/mrp/store) supaya lib/shell tidak bergantung ke store, cukup ke bentuk datanya. */
type MrpPoSentShape = { poSent: boolean; ppicApproval: string };

/** Helper murni untuk menghitung badge count "item pending yang butuh aksi user" per
 *  menu/sub-tab — dihitung langsung dari data store (bukan dari `notifications[]`).
 *  Definisi "pending" di sini konsisten dengan logic existing di tiap halaman terkait. */

export function countPendingMaterialPO(materialPOs: MaterialPO[]): number {
  return materialPOs.filter((p) => p.status !== "CANCELLED" && !p.approved).length;
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
 *  - Batch yang sudah masuk masa resting tapi belum di-"Update ke Cutting" (aksi nyata di tab Cutting).
 *  - MRP dengan sisa reject yang belum di-rework (aksi nyata di tab Reject/Rework). */
export function countVendorProduksiActionable(vendorId: string, productionBatches: ProductionBatch[], productionResults: ProductionResult[]): number {
  const awaitingCuttingUpdate = productionBatches.filter((b) => b.vendorProduksi === vendorId && !b.cuttingAt).length;
  const mrpWithRemainingReject = mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults).length;
  return awaitingCuttingUpdate + mrpWithRemainingReject;
}

/** Batch yang sudah masuk masa resting tapi belum di-"Update ke Cutting" — badge tab Cutting. */
export function countCuttingAwaitingUpdate(vendorId: string, productionBatches: ProductionBatch[]): number {
  return productionBatches.filter((b) => b.vendorProduksi === vendorId && !b.cuttingAt).length;
}

/** Warna/lengan yang sudah tercutting tapi belum ditandai "Done Produksi" — masih terbuka untuk
 *  input Finish Good/Reject. Dipakai badge tab Finish Good & Reject (sinyal sama: kedua tab itu
 *  aksinya sama-sama "input data produksi" selama grup belum ditutup). */
type GroupGap = { groupKey: string; totalTarget: number; totalFg: number; done: boolean };

function productionGroupGaps(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): GroupGap[] {
  const mrpIds = Array.from(new Set(productionBatches.filter((b) => b.vendorProduksi === vendorId && b.cuttingAt).map((b) => b.mrpId)));
  const out: GroupGap[] = [];
  for (const mrpId of mrpIds) {
    for (const g of cutWarnaLenganGroups(mrpId, vendorId, productionBatches)) {
      const groupKey = mrpId + "|" + g.warna + "|" + g.lengan;
      const target = targetSizesForGroup(mrpId, g.warna, g.lengan, mrpDetails, productionBatches);
      const totalTarget = Object.values(target).reduce((a, b) => a + b, 0);
      const totalFg = Object.values(cumulativeSizeQtyForGroup(groupKey, "FG", productionResults)).reduce((a, b) => a + b, 0);
      const done = !!productionGroupMeta.find((m) => m.groupKey === groupKey)?.doneAt;
      out.push({ groupKey, totalTarget, totalFg, done });
    }
  }
  return out;
}

/** Warna/lengan yang Finish Good-nya belum menutup seluruh target cutting — badge tab Finish
 *  Good. Beda dari Reject: FG relevan begitu ada yang dicutting, jadi tidak butuh prasyarat lain. */
export function countFgShortfallGroups(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails).filter((g) => !g.done && g.totalFg < g.totalTarget).length;
}

/** Badge tab Reject — SENGAJA baru nyala begitu Finish Good sudah mulai dilaporkan (totalFg > 0)
 *  untuk grup itu, bukan langsung sejak cutting selesai. Sebelum ada input Finish Good sama
 *  sekali, belum ada dasar untuk bilang ada "reject" yang perlu ditindak (dulu badge ini salah
 *  ikut nyala dari sinyal yang sama dengan Finish Good, jadi tampil padahal belum ada input apa
 *  pun — lihat catatan di app/vendor-maklon/production/page.tsx). */
export function countRejectActionableGroups(
  vendorId: string,
  productionBatches: ProductionBatch[],
  productionResults: ProductionResult[],
  productionGroupMeta: ProductionGroupMeta[],
  mrpDetails: MrpDetail[]
): number {
  return productionGroupGaps(vendorId, productionBatches, productionResults, productionGroupMeta, mrpDetails).filter((g) => !g.done && g.totalFg > 0 && g.totalFg < g.totalTarget).length;
}

/** MRP dengan sisa reject yang belum di-rework — badge tab Rework. */
export function countRemainingRework(vendorId: string, productionBatches: ProductionBatch[], productionResults: ProductionResult[]): number {
  return mrpIdsWithRemainingReject(vendorId, productionBatches, productionResults).length;
}

/** Invoice raw material yang masih ada roll/add-buy belum ditimbang & diinput di halaman
 *  Good Receive. Tidak cukup cek `status === "RECEIVING"` — status itu cuma berubah sekali
 *  saat roll pertama diinput dan tidak pernah balik lagi walau semua roll sudah lengkap
 *  (lihat `invoiceFullyReceived`), jadi badge harus cek kelengkapan asli datanya. */
export function countVendorGoodReceiveEligible(vendorId: string, invoices: RawMaterialInvoice[]): number {
  return invoices.filter(
    (i) => i.destinationVendor === vendorId && (i.status === "DELIVERY" || i.status === "RECEIVING") && !invoiceFullyReceived(i)
  ).length;
}

/** MRP dengan hasil produksi (FG/reject/rework) yang belum dikemas ke koli pengiriman. */
export function countVendorPengirimanReady(vendorId: string, productionResults: ProductionResult[], deliveryKolis: DeliveryKoli[]): number {
  return mrpIdsWithUnpackedFg(vendorId, productionResults, deliveryKolis).length;
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
