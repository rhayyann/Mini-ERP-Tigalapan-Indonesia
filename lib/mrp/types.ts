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
  /** Item 21 (migration 0016) — "Close PO" untuk siklus produksi parsial: begitu terisi, SEMUA
   *  warna/lengan PO Produksi ini terkunci (tidak ada FG/reject/rework baru) DAN semua Finish Good
   *  yang belum masuk koli (termasuk yang sudah fgConfirmed sebelum ditutup) tidak lagi shippable
   *  — lihat closeProductionPoAction & availableFgToShip di lib/mrp/derive.ts. Tidak menambah nilai
   *  enum baru ke MaklonPoStatus supaya badge map lama tidak perlu disentuh.
   */
  closedAt?: string;
  closeReason?: string;
};

export type InvoiceStatus = "WAITING_INVOICE" | "INVOICED" | "PAID" | "DELIVERY" | "RECEIVING" | "WAITING_PRODUCTION" | "PRODUCTION_DONE";

export type ColorEntry = { warna: string; lengan: Lengan; hargaPerRoll: number; rolls: number[] };
// hargaPerKg: harga per kg yang diinput user — totalHarga (dipakai di semua kalkulasi lain,
// termasuk hppRowsForInvoice) SELALU = beratKg * hargaPerKg, dihitung otomatis begitu salah satu
// dari keduanya diubah (lihat updateAddBuyBerat/updateAddBuyHargaPerKg di paying-voucher-wizard.tsx).
// Optional supaya data lama (sebelum field ini ada, totalHarga diisi langsung tanpa rate) tetap
// valid — totalHarga-nya sendiri tidak berubah/tidak perlu dimigrasikan.
export type AddBuyItem = { id: string; item: string; warna: string; beratKg: number; hargaPerKg?: number; totalHarga: number; remark: string };

export type RollReceipt = {
  netKg: number;
  receivedAt: string;
  codeRoll?: string;
  codeLot?: string;
  /** Ada tidaknya foto bukti berat bersih (item 2/3, migration 0014) -- payload asli TIDAK ada di
   *  sini (sengaja dikeluarkan dari snapshot, lihat material_claim_photos), cuma flag timestamp
   *  buat tahu apakah roll ini punya foto yang bisa diambil lewat getMaterialClaimPhotoAction. */
  claimPhotoAt?: string;
  /** Tahap "Konfirmasi" (item 13, migration 0015) yang menutup tahap timbang di Cutting sebelum
   *  roll bisa dipilih untuk Resting -- lihat availableCodeRollsForColor/weighedUnconfirmedRolls
   *  di lib/mrp/derive.ts. Null lagi kalau roll ini kena claim baru (harus ditimbang ulang). */
  weighConfirmedAt?: string;
};

/** Roll yang sudah ditandai FISIK DITERIMA di Good Receive (arrivedAt) — belum tentu sudah
 *  ditimbang (lihat RollReceipt). Ditimbang & dicek toleransi sekarang di halaman Cutting, bukan
 *  di sini lagi — Good Receive tinggal konfirmasi roll sudah datang + tag code roll/lot-nya. */
export type RollArrival = { arrivedAt: string; codeRoll?: string; codeLot?: string };

export type AddBuyReceipt = { receivedAt: string };

/** Arsip/histori 1 siklus klaim selisih berat, dari roll ditimbang di luar toleransi sampai
 *  selesai (auto lewat timbang ulang sesuai toleransi, atau ditutup manual) — lihat migration
 *  0011_material_claim_history.sql. Beda dari status klaim AKTIF di
 *  app/procurement/material-claims/page.tsx (yang diturunkan live dari kolom
 *  raw_material_invoice_rolls) -- tabel ini catatan permanen buat pencatatan, `resolvedAt`
 *  kosong berarti masih terbuka. */
export type MaterialClaimHistory = {
  id: string;
  invoiceId: string;
  poId?: string;
  mrpId?: string;
  supplier?: string;
  vendorProduksi?: string;
  warna: string;
  lengan: Lengan;
  rollIndex: number;
  codeRoll?: string;
  codeLot?: string;
  grossKg: number;
  claimedNetKg: number;
  diffKg: number;
  pct: number;
  claimedAt: string;
  returNote?: string;
  returRequestedAt?: string;
  returDeliveredNote?: string;
  returDeliveredAt?: string;
  returReceivedAt?: string;
  resolvedAt?: string;
  resolvedNote?: string;
  resolutionKind?: "AUTO_REWEIGH" | "MANUAL";
  resolvedNetKg?: number;
  resolvedCodeRoll?: string;
  /** Sama seperti RollReceipt.claimPhotoAt -- flag ada/tidaknya foto bukti berat bersih yang
   *  disimpan waktu klaim ini diajukan (item 2/3, migration 0014). */
  claimPhotoAt?: string;
};

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
  /** Sejajar index dengan colorEntries[].rolls / rollReceipts — null berarti roll itu belum
   *  ditandai diterima di Good Receive. Diisi oleh markRollArrivedAction. */
  rollArrivals: Record<string, (RollArrival | null)[]>;
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
  /** Hasil aduan AKTUAL (qty per size) dari roll ini, dicatat vendor saat "Update ke Cutting" —
   *  kosong kalau belum diisi (batch lama sebelum fitur ini ada, atau memang belum diinput).
   *  Dipakai untuk target/yield per roll (lihat productionYieldAlertsList di derive.ts), BUKAN
   *  estimasi rasio seperti targetSizesForGroup. */
  sizeQty?: Record<string, number>;
};

/** Catatan resolusi alert yield (<99%) per roll — dilempar ke portal internal Produksi, bukan ke
 *  Procurement (beda dari material claim). Ada = alert ini sudah ditindaklanjuti/di-approve. */
export type ProductionYieldResolution = { note: string; resolvedAt: string };

/** "WASTE" = reject yang dibuang jadi sisa/majun/kain perca — TIDAK bisa dirework jadi baju lagi
 *  (beda dari reject yang masih di-rework ke FG). Dicatat lewat wasteRejectSizeAction, mirror
 *  reworkRejectSizeAction tapi tanpa lengan/size tujuan (hasilnya bukan garmen). */
export type ProductionResultKind = "FG" | "REJECT" | "WASTE";
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

// Item 20 (feedback batch 2026-09-04): Reject bukan barang yang bisa dikirim -- cuma catatan
// historis per PO/MRP. ShippableKind sekarang cuma yang BENAR-BENAR boleh ditambahkan ke koli baru
// (lihat PRODUCT_KIND_OPTIONS di app/vendor-maklon/pengiriman/page.tsx). DeliveryItemKind tetap
// mengizinkan "REJECT" supaya koli LAMA yang sudah terlanjur berisi baris Reject (dari sebelum
// perubahan ini) masih typecheck & tampil normal -- tidak ada migrasi/penghapusan data historis.
export type ShippableKind = "FG" | "REWORK";
export type DeliveryItemKind = ShippableKind | "REJECT";

export type DeliveryKoliItem = { warna: string; lengan: Lengan; size: string; qty: number; kind: DeliveryItemKind; usia?: Usia };

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
  /** Tahap 1: "Selesai Produksi" diklik di tab FINISH GOOD -- reject dihitung otomatis di titik
   *  ini (cutting dikurangi Finish Good), tapi Rework/Buang ke Sisa TETAP boleh jalan sesudahnya
   *  (dikunci oleh `doneAt`, bukan field ini). Beda dari `doneAt` (tahap 2, final produksi) --
   *  lihat catatan lengkap di markProductionGroupDoneAction/confirmFgDoneAction. */
  fgConfirmedAt?: string;
  /** Tahap 2: "Selesai Produksi" diklik di tab FINAL PRODUKSI -- KUNCI FINAL grup ini (Finish
   *  Good/Reject/Rework/Waste tidak bisa berubah lagi setelah ini) & sumber status
   *  tepat-waktu/telat lewat productionStatusFromDates. Butuh `fgConfirmedAt` sudah terisi duluan.
   *  "Close PO" (item 21, closeProductionPoAction) mengisi ini secara massal untuk semua
   *  warna/lengan satu PO Produksi sekaligus.
   *  PENTING (item 22, direvisi dari desain awal sesi ini): `doneAt` BUKAN LAGI gate Pengiriman --
   *  FG sudah boleh dikirim begitu `fgConfirmedAt` (tahap 1) terisi, karena reject sudah dihitung
   *  final di titik itu juga. Yang tetap memblokir Pengiriman cuma Close PO (`MaklonPO.closedAt`),
   *  bukan `doneAt` per grup -- lihat availableFgToShip di lib/mrp/derive.ts. */
  doneAt?: string;
  remarkSisaReject?: string;
};
