export type Lengan = "PENDEK" | "PANJANG";

export type SizeQty = { size: string; qty: number };

export type LenganGroup = {
  id: string;
  warna: string;
  lengan: Lengan;
  sizes: SizeQty[];
  totalQty: number;
  ribKg: number;
  rollEstimate: number;
  vendorDefault: string;
};

export type AduanPolaRow = {
  id: string;
  lenganGroupId: string;
  warna: string;
  lengan: Lengan;
  kode: string;
  qtyRoll: number;
  sizes: SizeQty[];
  qty: number;
  vendor: string;
  ribAllocatedRoll?: number;
};

export type MaterialRow = {
  id: string;
  lenganGroupId: string;
  warna: string;
  lengan: Lengan;
  qtyRoll: number;
  ribKg: number;
  supplier: string | null;
  entitas?: string;
};

export type MrpStatusPO = "DRAFT" | "PO SENT" | "PO APPROVED";
export type MrpStatusRawMaterial = "BELUM MULAI" | "WAITING INVOICE" | "INVOICED" | "PAID" | "DELIVERY";
export type MrpStatusProduksi = "BELUM MULAI" | "WAITING MATERIAL" | "PARTIAL PRODUCTION" | "PRODUCTION" | "DELIVERY" | "SELESAI";

export type Mrp = {
  id: string;
  kategori: string;
  warna: string;
  targetDate: string;
  live: boolean;
  qty: number;
  isFob?: boolean;
};

export type MaterialPoStatus = "WAITING_INVOICE" | "INVOICE" | "PAYMENT" | "DELIVERY_MATERIAL" | "PROSES_PRODUKSI" | "CANCELLED";

export type ColorBreakdown = { warna: string; lengan: Lengan; rollCount: number; entitas?: string };

export type MaterialPO = {
  id: string;
  mrpId: string;
  vendorProduksi: string;
  supplier: string;
  warna: string;
  lengan: Lengan;
  colorBreakdown: ColorBreakdown[];
  invoicedByColor: Record<string, number>;
  rollCount: number;
  availableRolls: number;
  invoicedRolls: number;
  amount: number;
  entity: string;
  status: MaterialPoStatus;
  approved: boolean;
  daysSincePO: number;
};

export type MaklonPoStatus =
  | "FULL_WAITING_MATERIAL"
  | "PARTIAL_WAITING_MATERIAL"
  | "PRODUCTION"
  | "PARTIAL_PRODUCTION"
  | "DELIVERY"
  | "INVOICE"
  | "PAID"
  | "FULLY_PAID";

export type MaklonPO = {
  id: string;
  mrpId: string;
  vendorProduksi: string;
  qty: number;
  amount: number;
  entity: string;
  status: MaklonPoStatus;
  approved: boolean;
  cancelledLines: { note: string; rolls: number; warna?: string; lengan?: Lengan; pcs?: number; from?: string; time: string }[];
};

export type InvoiceStatus = "WAITING_INVOICE" | "INVOICED" | "PAID" | "DELIVERY" | "RECEIVING" | "WAITING_PRODUCTION" | "PRODUCTION_DONE";

export type ColorEntry = { warna: string; lengan: Lengan; hargaPerRoll: number; rolls: number[] };
// hargaPerKg: harga per kg yang diinput user — totalHarga (dipakai di semua kalkulasi lain,
// termasuk hppRowsForInvoice) SELALU = beratKg * hargaPerKg, dihitung otomatis begitu salah satu
// dari keduanya diubah (lihat updateAddBuyBerat/updateAddBuyHargaPerKg di paying-voucher-wizard.tsx).
// Optional supaya data lama (sebelum field ini ada, totalHarga diisi langsung tanpa rate) tetap
// valid — totalHarga-nya sendiri tidak berubah/tidak perlu dimigrasikan.
export type AddBuyItem = { id: string; item: string; warna: string; beratKg: number; hargaPerKg?: number; totalHarga: number; remark: string };

export type RollReceipt = { netKg: number; receivedAt: string; codeRoll?: string; codeLot?: string };

export type AddBuyReceipt = { receivedAt: string };

export type RawMaterialInvoice = {
  id: string;
  poId: string;
  mrpId: string;
  vendorProduksi: string;
  supplier: string;
  colorEntries: ColorEntry[];
  addBuys: AddBuyItem[];
  qtyReady: number;
  diskon: number;
  totalBiaya: number;
  kodeTransaksi: string;
  noInvoiceVendor: string;
  entity: string;
  status: InvoiceStatus;
  destinationVendor: string;
  bookedAt: string;
  /** Bukti Paying Voucher (PDF) yang diupload Procurement sebelum PV ini bisa diajukan — disimpan
   *  sebagai data URI base64 (belum ada backend/object storage, lihat catatan di lib/mrp/store.ts
   *  bookInvoice). `buktiPvFileName` cuma buat tampilan (nama file asli), bukan dipakai logic. */
  buktiPvDataUrl?: string;
  buktiPvFileName?: string;
  paidAt?: string;
  deliveredAt?: string;
  receivedAt?: string;
  productionStart?: string;
  productionEnd?: string;
  rollReceipts: Record<string, (RollReceipt | null)[]>;
  addBuyReceipts: Record<string, AddBuyReceipt>;
};

export type NotificationAudience = "ppic" | "procurement" | "finance" | "scm" | "produksi" | "vendorMaklon" | "vendorSupplier" | "admin";

export type Notification = {
  id: string;
  text: string;
  time: string;
  audience: NotificationAudience[];
  vendorId?: string;
  read: boolean;
};

export type MaklonInvoiceStatus = "SUBMITTED" | "APPROVED" | "PAID";

export type MaklonInvoice = {
  id: string;
  maklonPoId: string;
  mrpId: string;
  vendorProduksi: string;
  baseFee: number;
  penalty: number;
  bonus: number;
  retentionPct: number;
  netAmount: number;
  entity: string;
  status: MaklonInvoiceStatus;
  note: string;
  submittedAt: string;
  approvedAt?: string;
  paidAt?: string;
};

export type ProductionBatch = {
  id: string;
  mrpId: string;
  vendorProduksi: string;
  aduanRowId: string;
  kode: string;
  warna: string;
  lengan: Lengan;
  qtyRoll: number;
  gramasi: number;
  restingAt: string;
  cuttingAt?: string;
  createdAt: string;
  codeRoll?: string;
};

export type ProductionResultKind = "FG" | "REJECT";
export type Usia = "KIDS" | "DEWASA";

export type ProductionResult = {
  id: string;
  groupKey: string;
  mrpId: string;
  vendorProduksi: string;
  poId: string;
  warna: string;
  lengan: Lengan;
  kind: ProductionResultKind;
  sizeQty: Record<string, number>;
  recordedAt: string;
  note?: string;
  usia?: Usia;
};

export type ShippableKind = "FG" | "REJECT" | "REWORK";

export type DeliveryKoliItem = { warna: string; lengan: Lengan; size: string; qty: number; kind: ShippableKind; usia?: Usia };

export type DeliveryKoli = {
  id: string;
  mrpId: string;
  vendorProduksi: string;
  ekspedisi: string;
  noKoli: string;
  items: DeliveryKoliItem[];
  beratKoli?: number;
  deliveredAt?: string;
  createdAt: string;
};

export type VendorInvoiceLine = { mrpId: string; warna: string; lengan: Lengan; usia?: Usia; qty: number; ratePerPc: number; amount: number };

export type VendorInvoiceStatus = "SUBMITTED" | "REVISION" | "APPROVED" | "PAID";

// TIDAK_ADA = catatan eksplisit "tidak ada sanksi/reward" (mis. vendor kirim tepat waktu) —
// amount-nya selalu 0 dan sengaja TIDAK ikut kena filter "DENDA"/"REWARD" manapun (lihat
// vendorInvoiceAdjustmentTotal di lib/mrp/derive.ts), jadi murni jejak audit, tidak memengaruhi
// perhitungan tagihan.
export type VendorInvoiceAdjustmentKind = "DENDA" | "REWARD" | "TIDAK_ADA";

export type VendorInvoiceAdjustment = { id: string; kind: VendorInvoiceAdjustmentKind; label: string; amount: number; note?: string; addedAt: string };

export type VendorInvoice = {
  id: string;
  vendorProduksi: string;
  lines: VendorInvoiceLine[];
  totalTagihan: number;
  /** Sama dengan totalTagihan — dipertahankan sebagai field terpisah (bukan dihapus) karena
   *  vendorInvoiceFinalAmount/vendorInvoiceTotalPaid di lib/mrp/derive.ts sudah dibangun di atas
   *  field ini untuk hitungan denda/reward; retensi sudah TIDAK ADA lagi (hasil keputusan bisnis
   *  terbaru — pembayaran sekarang cuma sekali lunas penuh, lihat payVendorInvoice). */
  netTagihan: number;
  adjustments: VendorInvoiceAdjustment[];
  status: VendorInvoiceStatus;
  note?: string;
  submittedAt: string;
  approvedAt?: string;
  paidAt?: string;
  dueDate?: string;
  /** Total ongkos kirim untuk invoice ini, dari invoice ekspedisi — dipakai untuk menghitung
   *  ongkir per pc di laporan HPP. Diisi manual (belum ada sumber data ekspedisi terstruktur). */
  ongkirTotal?: number;
};

export type ProductionGroupMeta = {
  groupKey: string;
  mrpId: string;
  vendorProduksi: string;
  warna: string;
  lengan: Lengan;
  doneAt?: string;
  remarkSisaReject?: string;
};
