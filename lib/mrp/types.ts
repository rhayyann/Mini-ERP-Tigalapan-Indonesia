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

// Item revisi 2026-09-08 (owner: "Belum ada input kode lot per rollnya" -- kelanjutan dari
// keputusan 2026-09-07 yang sengaja MENUNDA input manual ini, "buat otomatis terisi untuk saat
// ini saja"): `lots` opsional, PARALEL ke `rolls` (index sama) -- kode lot per roll diinput
// Procurement di sini (paying-voucher-wizard.tsx) saat input berat, bukan lagi di-generate random
// di Good Receive vendor. Optional supaya invoice LAMA (dari sebelum field ini ada) tetap valid.
export type ColorEntry = { warna: string; lengan: Lengan; hargaPerRoll: number; rolls: number[]; lots?: string[] };
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
  /** Item 13 (feedback batch 2026-09-10, migration 0023): claim FISIK (shading/kotor/dll,
   *  ditemukan vendor saat menghamparkan roll untuk resting) -- BEDA dari claim berat
   *  (weightVariance-based), roll ini bisa tetap DALAM toleransi berat tapi tetap diklaim karena
   *  cacat fisik. Diajukan dari production-cutting-tab.tsx (checkbox + foto + catatan pada roll
   *  yang sudah masuk resting/ProductionBatch), lihat submitCuttingDefectClaimAction. */
  claimDefectNote?: string;
  claimDefectAt?: string;
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
  /** Item 2026-09-10 (bug fix: "Buat PV Pengganti" gagal untuk klaim FISIK, migration 0025) --
   *  `claimedNetKg`/`diffKg`/`pct` cuma berarti untuk klaim BERAT (selisih timbang, `reason`
   *  "BERAT") -- kosong (`undefined`) untuk klaim FISIK (`reason` "FISIK"), yang pakai
   *  `defectNote` sebagai gantinya. Dulu kolom-kolom ini NOT NULL di DB (tabel ini awalnya murni
   *  klaim berat) -- lihat migration 0025. */
  claimedNetKg?: number;
  diffKg?: number;
  pct?: number;
  /** Sama seperti MaterialClaimRow.reason (lib/mrp/derive.ts) -- default "BERAT" untuk baris
   *  lama (dibuat sebelum kolom ini ada di migration 0025). */
  reason: "BERAT" | "FISIK";
  /** Keterangan cacat fisik (padanan diffKg/pct untuk klaim BERAT) -- cuma terisi untuk klaim
   *  `reason === "FISIK"`. */
  defectNote?: string;
  claimedAt: string;
  returNote?: string;
  returRequestedAt?: string;
  returDeliveredNote?: string;
  returDeliveredAt?: string;
  returReceivedAt?: string;
  resolvedAt?: string;
  resolvedNote?: string;
  resolutionKind?: "AUTO_REWEIGH" | "MANUAL" | "RETUR_REORDER";
  resolvedNetKg?: number;
  resolvedCodeRoll?: string;
  /** Sama seperti RollReceipt.claimPhotoAt -- flag ada/tidaknya foto bukti berat bersih yang
   *  disimpan waktu klaim ini diajukan (item 2/3, migration 0014). */
  claimPhotoAt?: string;
  /** Revisi 2026-09-06: terisi kalau `resolutionKind === "RETUR_REORDER"` -- id RawMaterialInvoice
   *  PV pengganti yang dibuat untuk menyelesaikan klaim ini (lihat
   *  createClaimReplacementInvoiceAction, RawMaterialInvoice.sourceClaimId). */
  replacementInvoiceId?: string;
};

/** Revisi 2026-09-06: 1 baris ledger saldo deposit vendor (per SUPPLIER, bukan per PO/invoice) --
 *  CREDIT masuk begitu klaim selisih berat diselesaikan lewat "retur + pesan ulang" dengan nilai
 *  pesanan baru LEBIH KECIL dari nilai yang sudah dibayar di invoice lama untuk roll yang diretur;
 *  DEBIT masuk begitu Finance memilih pakai sebagian/semua saldo saat membayar invoice APA PUN ke
 *  supplier yang sama (lihat applyVendorDepositAction, payment-panel.tsx). Saldo berjalan = SUM
 *  amount CREDIT dikurangi SUM amount DEBIT (lihat vendorDepositBalance di derive.ts) -- SENGAJA
 *  dihitung live dari seluruh baris ini, bukan disimpan sebagai 1 angka running-total terpisah,
 *  supaya tidak ada 2 sumber kebenaran saldo yang bisa selisih. */
export type VendorDepositEntry = {
  id: string;
  supplier: string;
  kind: "CREDIT" | "DEBIT";
  /** Selalu POSITIF -- arah efeknya ke saldo ditentukan oleh `kind`. */
  amount: number;
  /** Diisi untuk CREDIT: claim key asal ("invoiceId|warna|lengan|rollIndex"). */
  sourceClaimId?: string;
  /** Diisi untuk DEBIT: invoice yang pembayarannya memakai sebagian saldo ini. */
  sourceInvoiceId?: string;
  note?: string;
  createdAt: string;
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
  /** Bukti pembayaran (PDF) yang diupload Finance saat/setelah invoice ini dibayar — inilah
   *  bukti yang diserahkan Procurement ke vendor material. Sama seperti buktiPvDataUrl, payload
   *  data URI-nya SENGAJA tidak ikut snapshot (lihat migration 0017 + getInvoicePaymentProofAction)
   *  supaya tidak membengkakkan getFlowSnapshot() yang di-refetch tiap user tiap aksi — di sini
   *  cuma flag `bukti_bayar_at` yang ikut. */
  buktiBayarAt?: string;
  buktiBayarFileName?: string;
  /** Revisi 2026-09-06: terisi kalau invoice ini adalah PV PENGGANTI hasil klaim selisih berat
   *  yang diselesaikan lewat "retur + pesan ulang" (lihat createClaimReplacementInvoiceAction &
   *  MaterialClaimHistory.replacementInvoiceId) -- nilainya claim key asal ("invoiceId|warna|
   *  lengan|rollIndex", format sama seperti materialClaimsList). Dipakai untuk: (1) exclude dari
   *  demand planning MRP (kebutuhan roll/pcs-nya sudah terhitung di invoice ASLI yang diretur,
   *  ini cuma re-sourcing bukan demand baru), (2) badge "Reorder klaim" di UI supaya invoice ini
   *  kelihatan beda dari invoice biasa. TIDAK ada hubungannya dengan saldo deposit (VendorDepositEntry)
   *  -- itu ledger fungible terpisah per supplier, tidak terikat ke invoice pengganti manapun.
   */
  sourceClaimId?: string;
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
  /** Revisi 2026-09-07 (HPP per roll, migration 0020): hasil Finish Good AKTUAL per size untuk
   *  roll ini SENDIRI — beda dari `sizeQty` di atas (itu TARGET hasil cutting). Diisi vendor lewat
   *  "Tutup Roll" (closeProductionBatchAction), yang JUGA dual-write 1 ProductionResult kind FG
   *  (groupKey warna+lengan, note "Roll {codeRoll}") supaya semua alur lama (Reject/Rework, badge,
   *  Selesai Produksi tahap 1/2, Pengiriman Rework) tetap jalan tanpa berubah — lihat plan HPP per
   *  roll. Kosong = roll ini belum ditutup. */
  fgSizeQty?: Record<string, number>;
  /** Revisi 2026-09-07: roll ini sudah "Tutup Roll" — FG-nya final & siap masuk Pengiriman (per
   *  roll, lihat DeliveryKoli.sourceBatchIds), tidak bisa diedit lagi lewat form Finish Good. */
  closedAt?: string;
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

export type DeliveryKoliItem = {
  warna: string;
  lengan: Lengan;
  size: string;
  qty: number;
  kind: DeliveryItemKind;
  usia?: Usia;
  /** Item 2026-09-10 (feedback: "input per size ... qty di roll yang telah ditentukan akan
   *  berkurang"): ProductionBatch (roll) asal item FG ini, di granularitas SIZE yang sama dengan
   *  `qty` -- BEDA dari `DeliveryKoli.sourceBatchIds` lama (level-koli, whole-roll) -- ini yang
   *  memungkinkan 1 roll nyebar ke banyak koli (tiap item independen menyimpan roll asalnya
   *  sendiri, migration 0024). Kosong untuk Rework/item non-roll, atau koli lama (sebelum
   *  migration 0024) yang masih pakai `sourceBatchIds` level-koli. */
  sourceBatchId?: string;
};

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
  /** LEGACY (migration 0020, sebelum roll boleh dikirim sebagian) -- id ProductionBatch (roll)
   *  yang mengisi koli ini, level-KOLI (whole-roll). Koli BARU (sejak migration 0024) tidak lagi
   *  menulis ke sini -- tracing sekarang per-item lewat `DeliveryKoliItem.sourceBatchId`, yang bisa
   *  merepresentasikan roll yang dikirim SEBAGIAN. Field ini TETAP dibaca sebagai fallback untuk
   *  koli lama yang datanya cuma ada di sini. */
  sourceBatchIds?: string[];
  /** Item 2026-09-10 (feedback: "Saat pilih ekspedisi juga nanti akan ada input gambar lampiran
   *  (note dari ekspedisi)"): keterangan WAJIB diisi bareng `ekspedisi` (satu aksi atomik, lihat
   *  setKoliEkspedisiResiGroupAction sejak migration 0026 -- dulu setKoliEkspedisiAction, sudah
   *  dihapus) -- byte foto lampirannya sendiri TIDAK ikut sini (lihat
   *  delivery_koli_ekspedisi_photos, migration 0024, pola sama material_claim_photos), cuma flag
   *  `ekspedisiNoteAt` yang menandakan ada/tidaknya. Sejak migration 0026, No Resi TIDAK lagi
   *  digabung di sini -- lihat `noResi` terpisah di bawah. */
  ekspedisiNote?: string;
  ekspedisiNoteAt?: string;
  /** Item 2026-09-11 (feedback: "Checkbox Koli yang mau dikirim (disamakan ekspedisinya - jadi
   *  satu resi)", migration 0026) -- menyatukan >=1 koli yang dikirim bareng lewat SATU aksi "Set
   *  Ekspedisi & Resi" (lihat setKoliEkspedisiResiGroupAction). SETIAP koli (termasuk yang dikirim
   *  sendirian) SELALU dapat resiGroupId begitu ekspedisinya di-set -- "grup isi 1" adalah kasus
   *  NORMAL (bukan jalur khusus terpisah) di semua perhitungan yang baca field ini, lihat
   *  koliOngkirShare (lib/mrp/derive.ts). Kosong untuk koli LAMA (sebelum migration 0026). */
  resiGroupId?: string;
  /** Nomor resi/tracking dari ekspedisi -- dulu tergabung bebas di `ekspedisiNote` (migration
   *  0024), sekarang field tersendiri (migration 0026). */
  noResi?: string;
  /** Menandai grup resi ini (semua koli dgn resiGroupId yang sama) SUDAH pernah dibuatkan invoice
   *  vendor lewat "Submit Invoice" (lihat submitResiGroupInvoiceAction) -- mencegah submit dobel. */
  resiInvoicedAt?: string;
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
