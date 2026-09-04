import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "../../supabase/server";
import type {
  AddBuyItem,
  AduanPolaRow,
  ColorBreakdown,
  ColorEntry,
  DeliveryKoli,
  DeliveryKoliItem,
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
  RollArrival,
  RollReceipt,
  VendorInvoice,
  VendorInvoiceAdjustment,
  VendorInvoiceLine,
} from "../types";
import type { EntitasRow, HargaKainPksRow, HargaKainRow, HargaMaklonRow, SupplierRow } from "../masterData";
import type { FlowState, MrpDates, MrpDetail } from "../store";

/** Ambil SEMUA data flow dari Supabase dan bentuk ulang jadi `FlowState` -- bentuk persis yang
 *  dipakai lib/mrp/store.ts & lib/mrp/derive.ts (TIDAK diubah), supaya 43 file consumer lama
 *  nyaris tidak perlu disentuh (lihat keputusan arsitektur #3 di plan migrasi). Dipanggil sekali
 *  saat StoreHydrator mount, dan lagi setiap kali ada mutasi (lihat lib/mrp/actions.ts) atau
 *  notifikasi Realtime masuk. */
/** Baris tiap tabel, dibungkus persis bentuk `{data, error}` yang dikembalikan supabase-js query
 *  builder -- supaya SELURUH kode di bawah (loop error-check, `.data ?? []` di mana-mana) tidak
 *  perlu tahu/berubah entah datanya datang dari RPC (cepat) atau query per-tabel (lambat,
 *  fallback). Ini SATU-SATUNYA kontrak yang harus dipenuhi kedua cara fetch di bawah. */
// `any` sengaja dipakai di sini -- sama seperti tipe row yang sudah diam-diam dipakai di seluruh
// file ini (supabaseServer() tidak pakai generic Database type), supaya kedua cara fetch (RPC vs
// query per-tabel) benar-benar cocok bentuknya.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TableResult = { data: any[] | null; error: { message: string } | null };
type RawTables = Record<
  | "mrpRows"
  | "lenganGroupRows"
  | "lenganGroupSizeRows"
  | "aduanRows"
  | "aduanSizeRows"
  | "materialRowRows"
  | "materialPoRows"
  | "materialPoColorRows"
  | "materialPoInvoicedRows"
  | "maklonPoRows"
  | "maklonPoCancelledRows"
  | "invoiceRows"
  | "invoiceColorRows"
  | "invoiceRollRows"
  | "invoiceAddBuyRows"
  | "maklonInvoiceRows"
  | "productionBatchRows"
  | "productionBatchSizeRows"
  | "productionYieldResolutionRows"
  | "productionResultRows"
  | "productionResultSizeRows"
  | "productionGroupMetaRows"
  | "deliveryKoliRows"
  | "deliveryKoliItemRows"
  | "vendorInvoiceRows"
  | "vendorInvoiceLineRows"
  | "vendorInvoiceAdjustmentRows"
  | "materialClaimHistoryRows"
  | "notificationRows"
  | "hargaMaklonRows"
  | "hargaKainRows"
  | "hargaKainPksRows"
  | "entitasRows"
  | "supplierRows",
  TableResult
>;

/** Cara LAMA -- 32 query terpisah ke PostgREST lewat Promise.all. Tetap dipertahankan sebagai
 *  fallback (lihat fetchFlowRows) supaya app tidak pernah benar-benar berhenti bisa muat data
 *  cuma karena migration 0008 (RPC get_flow_snapshot_raw) belum sempat di-apply -- urutan deploy
 *  kode vs migration jadi tidak penting. */
async function fetchFlowRowsLegacy(db: SupabaseClient): Promise<RawTables> {
  const [
    mrpRows,
    lenganGroupRows,
    lenganGroupSizeRows,
    aduanRows,
    aduanSizeRows,
    materialRowRows,
    materialPoRows,
    materialPoColorRows,
    materialPoInvoicedRows,
    maklonPoRows,
    maklonPoCancelledRows,
    invoiceRows,
    invoiceColorRows,
    invoiceRollRows,
    invoiceAddBuyRows,
    maklonInvoiceRows,
    productionBatchRows,
    productionBatchSizeRows,
    productionYieldResolutionRows,
    productionResultRows,
    productionResultSizeRows,
    productionGroupMetaRows,
    deliveryKoliRows,
    deliveryKoliItemRows,
    vendorInvoiceRows,
    vendorInvoiceLineRows,
    vendorInvoiceAdjustmentRows,
    materialClaimHistoryRows,
    notificationRows,
    hargaMaklonRows,
    hargaKainRows,
    hargaKainPksRows,
    entitasRows,
    supplierRows,
  ] = await Promise.all([
    db.from("mrp").select("*"),
    db.from("lengan_groups").select("*"),
    db.from("lengan_group_sizes").select("*"),
    db.from("aduan_pola_rows").select("*"),
    db.from("aduan_pola_sizes").select("*"),
    db.from("material_rows").select("*"),
    db.from("material_pos").select("*"),
    db.from("material_po_color_breakdown").select("*"),
    db.from("material_po_invoiced_by_color").select("*"),
    db.from("maklon_pos").select("*"),
    db.from("maklon_po_cancelled_lines").select("*"),
    db.from("raw_material_invoices").select("*"),
    db.from("raw_material_invoice_colors").select("*"),
    db.from("raw_material_invoice_rolls").select("*"),
    db.from("raw_material_invoice_addbuys").select("*"),
    db.from("maklon_invoices").select("*"),
    db.from("production_batches").select("*"),
    db.from("production_batch_sizes").select("*"),
    db.from("production_yield_resolutions").select("*"),
    db.from("production_results").select("*"),
    db.from("production_result_sizes").select("*"),
    db.from("production_group_meta").select("*"),
    db.from("delivery_kolis").select("*"),
    db.from("delivery_koli_items").select("*"),
    db.from("vendor_invoices").select("*"),
    db.from("vendor_invoice_lines").select("*"),
    db.from("vendor_invoice_adjustments").select("*"),
    db.from("material_claim_history").select("*"),
    db.from("notifications").select("*"),
    db.from("harga_maklon").select("*"),
    db.from("harga_kain").select("*"),
    db.from("harga_kain_pks").select("*"),
    db.from("entitas").select("*"),
    db.from("suppliers").select("*"),
  ]);
  return {
    mrpRows,
    lenganGroupRows,
    lenganGroupSizeRows,
    aduanRows,
    aduanSizeRows,
    materialRowRows,
    materialPoRows,
    materialPoColorRows,
    materialPoInvoicedRows,
    maklonPoRows,
    maklonPoCancelledRows,
    invoiceRows,
    invoiceColorRows,
    invoiceRollRows,
    invoiceAddBuyRows,
    maklonInvoiceRows,
    productionBatchRows,
    productionBatchSizeRows,
    productionYieldResolutionRows,
    productionResultRows,
    productionResultSizeRows,
    productionGroupMetaRows,
    deliveryKoliRows,
    deliveryKoliItemRows,
    vendorInvoiceRows,
    vendorInvoiceLineRows,
    vendorInvoiceAdjustmentRows,
    materialClaimHistoryRows,
    notificationRows,
    hargaMaklonRows,
    hargaKainRows,
    hargaKainPksRows,
    entitasRows,
    supplierRows,
  };
}

/** Cara BARU (cepat) -- satu panggilan RPC (get_flow_snapshot_raw, lihat migration
 *  0008_flow_snapshot_rpc.sql) yang menggabungkan 32 tabel jadi satu objek JSON di DALAM
 *  Postgres, jadi cuma 1 round-trip jaringan total (dulu: 32 round-trip paralel, tiap satu
 *  tetap punya overhead koneksi/HTTP sendiri-sendiri). Throw kalau RPC-nya belum ada/gagal --
 *  fetchFlowRows di bawah yang menangkap ini dan fallback ke cara lama. */
async function fetchFlowRowsFast(db: SupabaseClient): Promise<RawTables> {
  const { data, error } = await db.rpc("get_flow_snapshot_raw");
  if (error || !data) throw error ?? new Error("get_flow_snapshot_raw: hasil kosong");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as Record<string, any[]>;
  const wrap = (key: string): TableResult => ({ data: raw[key] ?? [], error: null });
  return {
    mrpRows: wrap("mrp"),
    lenganGroupRows: wrap("lengan_groups"),
    lenganGroupSizeRows: wrap("lengan_group_sizes"),
    aduanRows: wrap("aduan_pola_rows"),
    aduanSizeRows: wrap("aduan_pola_sizes"),
    materialRowRows: wrap("material_rows"),
    materialPoRows: wrap("material_pos"),
    materialPoColorRows: wrap("material_po_color_breakdown"),
    materialPoInvoicedRows: wrap("material_po_invoiced_by_color"),
    maklonPoRows: wrap("maklon_pos"),
    maklonPoCancelledRows: wrap("maklon_po_cancelled_lines"),
    invoiceRows: wrap("raw_material_invoices"),
    invoiceColorRows: wrap("raw_material_invoice_colors"),
    invoiceRollRows: wrap("raw_material_invoice_rolls"),
    invoiceAddBuyRows: wrap("raw_material_invoice_addbuys"),
    maklonInvoiceRows: wrap("maklon_invoices"),
    productionBatchRows: wrap("production_batches"),
    productionBatchSizeRows: wrap("production_batch_sizes"),
    productionYieldResolutionRows: wrap("production_yield_resolutions"),
    productionResultRows: wrap("production_results"),
    productionResultSizeRows: wrap("production_result_sizes"),
    productionGroupMetaRows: wrap("production_group_meta"),
    deliveryKoliRows: wrap("delivery_kolis"),
    deliveryKoliItemRows: wrap("delivery_koli_items"),
    vendorInvoiceRows: wrap("vendor_invoices"),
    vendorInvoiceLineRows: wrap("vendor_invoice_lines"),
    vendorInvoiceAdjustmentRows: wrap("vendor_invoice_adjustments"),
    materialClaimHistoryRows: wrap("material_claim_history"),
    notificationRows: wrap("notifications"),
    hargaMaklonRows: wrap("harga_maklon"),
    hargaKainRows: wrap("harga_kain"),
    hargaKainPksRows: wrap("harga_kain_pks"),
    entitasRows: wrap("entitas"),
    supplierRows: wrap("suppliers"),
  };
}

async function fetchFlowRows(db: SupabaseClient): Promise<RawTables> {
  try {
    return await fetchFlowRowsFast(db);
  } catch (err) {
    // Migration 0008 belum di-apply, atau RPC gagal karena sebab lain -- diam-diam fallback ke
    // cara lama (lebih lambat, tapi tetap benar) alih-alih bikin SELURUH app gagal muat data.
    console.warn("getFlowSnapshot: get_flow_snapshot_raw gagal, fallback ke query per-tabel —", err instanceof Error ? err.message : err);
    return fetchFlowRowsLegacy(db);
  }
}

export async function getFlowSnapshot(): Promise<FlowState> {
  const db = supabaseServer();

  const {
    mrpRows,
    lenganGroupRows,
    lenganGroupSizeRows,
    aduanRows,
    aduanSizeRows,
    materialRowRows,
    materialPoRows,
    materialPoColorRows,
    materialPoInvoicedRows,
    maklonPoRows,
    maklonPoCancelledRows,
    invoiceRows,
    invoiceColorRows,
    invoiceRollRows,
    invoiceAddBuyRows,
    maklonInvoiceRows,
    productionBatchRows,
    productionBatchSizeRows,
    productionYieldResolutionRows,
    productionResultRows,
    productionResultSizeRows,
    productionGroupMetaRows,
    deliveryKoliRows,
    deliveryKoliItemRows,
    vendorInvoiceRows,
    vendorInvoiceLineRows,
    vendorInvoiceAdjustmentRows,
    materialClaimHistoryRows,
    notificationRows,
    hargaMaklonRows,
    hargaKainRows,
    hargaKainPksRows,
    entitasRows,
    supplierRows,
  } = await fetchFlowRows(db);

  for (const [name, res] of Object.entries({
    mrpRows,
    lenganGroupRows,
    aduanRows,
    materialRowRows,
    materialPoRows,
    maklonPoRows,
    invoiceRows,
    maklonInvoiceRows,
    productionBatchRows,
    productionResultRows,
    deliveryKoliRows,
    vendorInvoiceRows,
    notificationRows,
    hargaMaklonRows,
    hargaKainRows,
    hargaKainPksRows,
    entitasRows,
    supplierRows,
  })) {
    if (res.error) throw new Error(`getFlowSnapshot: gagal fetch ${name}: ${res.error.message}`);
  }

  // ---- MRP core: mrp + lengan_groups(+sizes) + aduan_pola_rows(+sizes) + material_rows ----
  const sizesByGroup = groupBy(lenganGroupSizeRows.data ?? [], (r) => r.lengan_group_id);
  const lenganGroupsByMrp = groupBy(lenganGroupRows.data ?? [], (r) => r.mrp_id);
  const sizesByAduan = groupBy(aduanSizeRows.data ?? [], (r) => r.aduan_row_id);
  const aduanByMrp = groupBy(aduanRows.data ?? [], (r) => r.mrp_id);
  const materialRowsByMrp = groupBy(materialRowRows.data ?? [], (r) => r.mrp_id);

  const mrpDetails: MrpDetail[] = (mrpRows.data ?? []).map((m) => {
    const mrp: Mrp = { id: m.id, kategori: m.kategori, warna: m.warna, targetDate: m.target_date, live: m.live, qty: m.qty, isFob: m.is_fob ?? undefined };
    const lenganGroups: LenganGroup[] = (lenganGroupsByMrp[m.id] ?? []).map((g) => ({
      id: g.id,
      warna: g.warna,
      lengan: g.lengan,
      sizes: (sizesByGroup[g.id] ?? []).map((s) => ({ size: s.size, qty: s.qty })),
      totalQty: g.total_qty,
      ribKg: Number(g.rib_kg),
      rollEstimate: Number(g.roll_estimate),
      vendorDefault: g.vendor_default ?? "",
    }));
    const aduanRowsForMrp: AduanPolaRow[] = (aduanByMrp[m.id] ?? []).map((a) => ({
      id: a.id,
      lenganGroupId: a.lengan_group_id,
      warna: a.warna,
      lengan: a.lengan,
      kode: a.kode,
      qtyRoll: Number(a.qty_roll),
      sizes: (sizesByAduan[a.id] ?? []).map((s) => ({ size: s.size, qty: s.qty })),
      qty: a.qty,
      vendor: a.vendor,
      ribAllocatedRoll: a.rib_allocated_roll == null ? undefined : Number(a.rib_allocated_roll),
    }));
    const materialRows: MaterialRow[] = (materialRowsByMrp[m.id] ?? []).map((r) => ({
      id: r.id,
      lenganGroupId: r.lengan_group_id,
      warna: r.warna,
      lengan: r.lengan,
      qtyRoll: Number(r.qty_roll),
      ribKg: Number(r.rib_kg),
      supplier: r.supplier,
      entitas: r.entitas ?? undefined,
    }));
    const dates: MrpDates = {
      created: m.created_at,
      ppicSubmitted: m.ppic_submitted_at ?? undefined,
      ppicApproved: m.ppic_approved_at ?? undefined,
      poSent: m.po_sent_at ?? undefined,
      poApproved: m.po_approved_at ?? undefined,
      firstInvoice: m.first_invoice_at ?? undefined,
      firstPayment: m.first_payment_at ?? undefined,
    };
    return {
      mrp,
      lenganGroups,
      aduanRows: aduanRowsForMrp,
      materialRows,
      poSent: m.po_sent,
      dates,
      ppicApproval: m.ppic_approval,
      ppicRejectionNote: m.ppic_rejection_note ?? undefined,
    };
  });
  // CATATAN MIGRASI: `staticMrps` di app ASLI tidak pernah diisi oleh action manapun di
  // lib/mrp/store.ts (tetap [] selamanya, semacam state vestigial) -- beberapa halaman (mis.
  // app/mrp/ppic/page.tsx) menggabungkan `mrpDetails` + `staticMrps` jadi satu daftar baris
  // tabel, jadi kalau ini diisi mirror dari mrpDetails, setiap MRP akan tampil DOBEL (satu dari
  // mrpDetails dengan status lengkap, satu lagi dari staticMrps tanpa detail -> badge "—").
  // SENGAJA dibiarkan kosong supaya perilakunya identik dengan app lama.
  const staticMrps: Mrp[] = [];

  // ---- Material PO ----
  const colorBreakdownByPo = groupBy(materialPoColorRows.data ?? [], (r) => r.material_po_id);
  const invoicedByColorByPo = groupBy(materialPoInvoicedRows.data ?? [], (r) => r.material_po_id);
  const materialPOs: MaterialPO[] = (materialPoRows.data ?? []).map((p) => {
    const colorBreakdown: ColorBreakdown[] = (colorBreakdownByPo[p.id] ?? []).map((c) => ({
      warna: c.warna,
      lengan: c.lengan,
      rollCount: Number(c.roll_count),
      entitas: c.entitas ?? undefined,
    }));
    const invoicedByColor: Record<string, number> = {};
    for (const row of invoicedByColorByPo[p.id] ?? []) invoicedByColor[row.color_key] = Number(row.invoiced_rolls);
    return {
      id: p.id,
      mrpId: p.mrp_id,
      vendorProduksi: p.vendor_produksi,
      supplier: p.supplier,
      warna: p.warna,
      lengan: p.lengan,
      colorBreakdown,
      invoicedByColor,
      rollCount: Number(p.roll_count),
      availableRolls: Number(p.available_rolls),
      invoicedRolls: Number(p.invoiced_rolls),
      amount: Number(p.amount),
      entity: p.entity ?? "",
      status: p.status,
      approved: p.approved,
      daysSincePO: p.days_since_po,
    };
  });

  // ---- Maklon PO ----
  const cancelledByPo = groupBy(maklonPoCancelledRows.data ?? [], (r) => r.maklon_po_id);
  const rejectRemarks: Record<string, string> = {};
  const maklonPOs: MaklonPO[] = (maklonPoRows.data ?? []).map((p) => {
    if (p.reject_remark) rejectRemarks[p.id] = p.reject_remark;
    return {
      id: p.id,
      mrpId: p.mrp_id,
      vendorProduksi: p.vendor_produksi,
      qty: p.qty,
      amount: Number(p.amount),
      entity: p.entity ?? "",
      status: p.status,
      approved: p.approved,
      cancelledLines: (cancelledByPo[p.id] ?? []).map((c) => ({
        note: c.note,
        rolls: Number(c.rolls),
        warna: c.warna ?? undefined,
        lengan: c.lengan ?? undefined,
        pcs: c.pcs ?? undefined,
        from: c.from_vendor ?? undefined,
        time: c.time,
      })),
      closedAt: p.closed_at ?? undefined,
      closeReason: p.close_reason ?? undefined,
    };
  });

  // ---- Raw material invoices ----
  const colorsByInvoice = groupBy(invoiceColorRows.data ?? [], (r) => r.invoice_id);
  const rollsByColor = groupBy(invoiceRollRows.data ?? [], (r) => r.invoice_color_id);
  const addBuysByInvoice = groupBy(invoiceAddBuyRows.data ?? [], (r) => r.invoice_id);
  const materialClaimResolutions: FlowState["materialClaimResolutions"] = {};
  const materialClaimReturRequests: FlowState["materialClaimReturRequests"] = {};
  const materialClaimReturDeliveries: FlowState["materialClaimReturDeliveries"] = {};
  const materialClaimReturReceipts: FlowState["materialClaimReturReceipts"] = {};

  const invoices: RawMaterialInvoice[] = (invoiceRows.data ?? []).map((inv) => {
    const colors = colorsByInvoice[inv.id] ?? [];
    const colorEntries: ColorEntry[] = [];
    const rollReceipts: Record<string, (RollReceipt | null)[]> = {};
    const rollArrivals: Record<string, (RollArrival | null)[]> = {};
    for (const c of colors) {
      const colorKey = `${c.warna}|${c.lengan}`;
      const rolls = (rollsByColor[c.id] ?? []).sort((a, b) => a.roll_index - b.roll_index);
      colorEntries.push({ warna: c.warna, lengan: c.lengan, hargaPerRoll: Number(c.harga_per_roll), rolls: rolls.map((r) => Number(r.gross_kg)) });
      // received_at = ditandai diterima (Good Receive, lihat markRollArrivedAction) — TIDAK lagi
      // berarti "sudah ditimbang" (itu net_kg, sekarang diisi dari Cutting lewat
      // receiveRawMaterialRollAction). Satu roll bisa "arrived" (received_at ada) tapi belum
      // "receipt" (net_kg masih null) sambil menunggu ditimbang di Cutting.
      rollReceipts[colorKey] = rolls.map((r) =>
        r.net_kg == null
          ? null
          : {
              netKg: Number(r.net_kg),
              receivedAt: r.received_at ?? "",
              codeRoll: r.code_roll ?? undefined,
              codeLot: r.code_lot ?? undefined,
              claimPhotoAt: r.claim_photo_at ?? undefined,
              weighConfirmedAt: r.weigh_confirmed_at ?? undefined,
            }
      );
      rollArrivals[colorKey] = rolls.map((r) =>
        r.received_at == null ? null : { arrivedAt: r.received_at, codeRoll: r.code_roll ?? undefined, codeLot: r.code_lot ?? undefined }
      );
      for (const r of rolls) {
        const claimKey = `${inv.id}|${c.warna}|${c.lengan}|${r.roll_index}`;
        if (r.claim_resolved_note != null) materialClaimResolutions[claimKey] = { note: r.claim_resolved_note, resolvedAt: r.claim_resolved_at ?? "" };
        if (r.claim_retur_note != null) materialClaimReturRequests[claimKey] = { note: r.claim_retur_note, requestedAt: r.claim_retur_requested_at ?? "" };
        if (r.claim_retur_delivered_at != null) materialClaimReturDeliveries[claimKey] = { note: r.claim_retur_delivered_note ?? "", deliveredAt: r.claim_retur_delivered_at };
        if (r.claim_retur_received_at != null) materialClaimReturReceipts[claimKey] = { receivedAt: r.claim_retur_received_at };
      }
    }
    const addBuys: AddBuyItem[] = (addBuysByInvoice[inv.id] ?? []).map((a) => ({
      id: a.id,
      item: a.item,
      warna: a.warna ?? "",
      beratKg: Number(a.berat_kg),
      hargaPerKg: a.harga_per_kg == null ? undefined : Number(a.harga_per_kg),
      totalHarga: Number(a.total_harga),
      remark: a.remark ?? "",
    }));
    const addBuyReceipts: Record<string, { receivedAt: string }> = {};
    for (const a of addBuysByInvoice[inv.id] ?? []) if (a.received_at) addBuyReceipts[a.id] = { receivedAt: a.received_at };

    return {
      id: inv.id,
      poId: inv.po_id,
      mrpId: inv.mrp_id,
      vendorProduksi: inv.vendor_produksi,
      supplier: inv.supplier,
      colorEntries,
      addBuys,
      qtyReady: Number(inv.qty_ready),
      diskon: Number(inv.diskon),
      totalBiaya: Number(inv.total_biaya),
      kodeTransaksi: inv.kode_transaksi ?? "",
      noInvoiceVendor: inv.no_invoice_vendor ?? "",
      entity: inv.entity ?? "",
      status: inv.status,
      destinationVendor: inv.destination_vendor ?? "",
      bookedAt: inv.booked_at,
      buktiPvDataUrl: inv.bukti_pv_storage_path ?? undefined,
      buktiPvFileName: inv.bukti_pv_file_name ?? undefined,
      paidAt: inv.paid_at ?? undefined,
      deliveredAt: inv.delivered_at ?? undefined,
      receivedAt: inv.received_at ?? undefined,
      productionStart: inv.production_start ?? undefined,
      productionEnd: inv.production_end ?? undefined,
      rollReceipts,
      rollArrivals,
      addBuyReceipts,
    };
  });

  // ---- Maklon invoice (legacy) ----
  const maklonInvoices: MaklonInvoice[] = (maklonInvoiceRows.data ?? []).map((i) => ({
    id: i.id,
    maklonPoId: i.maklon_po_id,
    mrpId: i.mrp_id,
    vendorProduksi: i.vendor_produksi,
    baseFee: Number(i.base_fee),
    penalty: Number(i.penalty),
    bonus: Number(i.bonus),
    retentionPct: Number(i.retention_pct),
    netAmount: Number(i.net_amount),
    entity: i.entity ?? "",
    status: i.status,
    note: i.note ?? "",
    submittedAt: i.submitted_at,
    approvedAt: i.approved_at ?? undefined,
    paidAt: i.paid_at ?? undefined,
  }));

  // ---- Produksi ----
  // production_batch_sizes/production_yield_resolutions belum tentu ada (butuh migration
  // 0006_production_batch_output.sql) — `.data ?? []` di bawah gracefully jadi kosong kalau
  // tabelnya belum ada, jadi TIDAK ditambahkan ke daftar error-check di atas (lihat komentar
  // serupa di query lain yang juga tidak wajib ada).
  const batchSizesByBatch = groupBy(productionBatchSizeRows.data ?? [], (r) => r.production_batch_id);
  const productionBatches: ProductionBatch[] = (productionBatchRows.data ?? []).map((b) => {
    const sizeRows = batchSizesByBatch[b.id] ?? [];
    const sizeQty: Record<string, number> = {};
    for (const s of sizeRows) sizeQty[s.size] = s.qty;
    return {
      id: b.id,
      mrpId: b.mrp_id,
      vendorProduksi: b.vendor_produksi,
      aduanRowId: b.aduan_row_id,
      kode: b.kode ?? "",
      warna: b.warna,
      lengan: b.lengan,
      qtyRoll: Number(b.qty_roll),
      gramasi: b.gramasi == null ? 0 : Number(b.gramasi),
      restingAt: b.resting_at ?? "",
      cuttingAt: b.cutting_at ?? undefined,
      createdAt: b.created_at,
      codeRoll: b.code_roll ?? undefined,
      sizeQty: sizeRows.length > 0 ? sizeQty : undefined,
    };
  });
  const productionYieldResolutions: Record<string, ProductionYieldResolution> = {};
  for (const r of productionYieldResolutionRows.data ?? []) {
    productionYieldResolutions[r.production_batch_id] = { note: r.note, resolvedAt: r.resolved_at };
  }

  const sizesByResult = groupBy(productionResultSizeRows.data ?? [], (r) => r.production_result_id);
  const productionResults: ProductionResult[] = (productionResultRows.data ?? []).map((r) => {
    const sizeQty: Record<string, number> = {};
    for (const s of sizesByResult[r.id] ?? []) sizeQty[s.size] = s.qty;
    return {
      id: r.id,
      groupKey: r.group_key,
      mrpId: r.mrp_id,
      vendorProduksi: r.vendor_produksi,
      poId: r.po_id,
      warna: r.warna,
      lengan: r.lengan,
      kind: r.kind,
      sizeQty,
      recordedAt: r.recorded_at,
      note: r.note ?? undefined,
      usia: r.usia ?? undefined,
    };
  });

  const productionGroupMeta: ProductionGroupMeta[] = (productionGroupMetaRows.data ?? []).map((g) => ({
    groupKey: g.group_key,
    mrpId: g.mrp_id,
    vendorProduksi: g.vendor_produksi,
    warna: g.warna,
    lengan: g.lengan,
    fgConfirmedAt: g.fg_confirmed_at ?? undefined,
    doneAt: g.done_at ?? undefined,
    remarkSisaReject: g.remark_sisa_reject ?? undefined,
  }));

  // ---- Delivery ----
  const itemsByKoli = groupBy(deliveryKoliItemRows.data ?? [], (r) => r.delivery_koli_id);
  const deliveryKolis: DeliveryKoli[] = (deliveryKoliRows.data ?? []).map((k) => ({
    id: k.id,
    mrpId: k.mrp_id,
    vendorProduksi: k.vendor_produksi,
    ekspedisi: k.ekspedisi ?? "",
    noKoli: k.no_koli ?? "",
    items: (itemsByKoli[k.id] ?? []).map<DeliveryKoliItem>((it) => ({ warna: it.warna, lengan: it.lengan, size: it.size, qty: it.qty, kind: it.kind, usia: it.usia ?? undefined })),
    beratKoli: k.berat_koli == null ? undefined : Number(k.berat_koli),
    deliveredAt: k.delivered_at ?? undefined,
    createdAt: k.created_at,
  }));

  // ---- Vendor invoice ----
  const linesByInvoice = groupBy(vendorInvoiceLineRows.data ?? [], (r) => r.vendor_invoice_id);
  const adjustmentsByInvoice = groupBy(vendorInvoiceAdjustmentRows.data ?? [], (r) => r.vendor_invoice_id);
  const vendorInvoices: VendorInvoice[] = (vendorInvoiceRows.data ?? []).map((v) => ({
    id: v.id,
    vendorProduksi: v.vendor_produksi,
    lines: (linesByInvoice[v.id] ?? []).map<VendorInvoiceLine>((l) => ({
      mrpId: l.mrp_id,
      warna: l.warna,
      lengan: l.lengan,
      usia: l.usia ?? undefined,
      qty: l.qty,
      ratePerPc: Number(l.rate_per_pc),
      amount: Number(l.amount),
    })),
    totalTagihan: Number(v.total_tagihan),
    netTagihan: Number(v.net_tagihan),
    adjustments: (adjustmentsByInvoice[v.id] ?? []).map<VendorInvoiceAdjustment>((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      amount: Number(a.amount),
      note: a.note ?? undefined,
      addedAt: a.added_at,
    })),
    status: v.status,
    note: v.note ?? undefined,
    submittedAt: v.submitted_at,
    approvedAt: v.approved_at ?? undefined,
    paidAt: v.paid_at ?? undefined,
    dueDate: v.due_date ?? undefined,
    ongkirTotal: v.ongkir_total == null ? undefined : Number(v.ongkir_total),
  }));

  // ---- Arsip/histori klaim selisih berat (lihat migration 0011_material_claim_history.sql) ----
  const materialClaimHistory: MaterialClaimHistory[] = (materialClaimHistoryRows.data ?? []).map((h) => ({
    id: h.id,
    invoiceId: h.invoice_id,
    poId: h.po_id ?? undefined,
    mrpId: h.mrp_id ?? undefined,
    supplier: h.supplier ?? undefined,
    vendorProduksi: h.vendor_produksi ?? undefined,
    warna: h.warna,
    lengan: h.lengan,
    rollIndex: h.roll_index,
    codeRoll: h.code_roll ?? undefined,
    codeLot: h.code_lot ?? undefined,
    grossKg: Number(h.gross_kg),
    claimedNetKg: Number(h.claimed_net_kg),
    diffKg: Number(h.diff_kg),
    pct: Number(h.pct),
    claimedAt: h.claimed_at,
    returNote: h.retur_note ?? undefined,
    returRequestedAt: h.retur_requested_at ?? undefined,
    returDeliveredNote: h.retur_delivered_note ?? undefined,
    returDeliveredAt: h.retur_delivered_at ?? undefined,
    returReceivedAt: h.retur_received_at ?? undefined,
    resolvedAt: h.resolved_at ?? undefined,
    resolvedNote: h.resolved_note ?? undefined,
    resolutionKind: h.resolution_kind ?? undefined,
    resolvedNetKg: h.resolved_net_kg == null ? undefined : Number(h.resolved_net_kg),
    resolvedCodeRoll: h.resolved_code_roll ?? undefined,
    claimPhotoAt: h.claim_photo_at ?? undefined,
  }));

  // ---- Notifikasi ----
  const notifications: Notification[] = (notificationRows.data ?? []).map((n) => ({
    id: n.id,
    text: n.text,
    time: n.time,
    audience: n.audience ?? [],
    vendorId: n.vendor_id ?? undefined,
    read: n.read,
  }));

  // ---- Master data ----
  const hargaMaklon: HargaMaklonRow[] = (hargaMaklonRows.data ?? []).map((r) => ({
    id: r.id,
    kodeVendor: r.kode_vendor,
    namaVendor: r.nama_vendor,
    tipeLengan: r.tipe_lengan,
    jenisHarga: r.jenis_harga,
    kapasitasMin: r.kapasitas_min ?? undefined,
    kapasitasMax: r.kapasitas_max ?? undefined,
    harga: Number(r.harga),
  }));
  const hargaKain: HargaKainRow[] = (hargaKainRows.data ?? []).map((r) => ({
    id: r.id,
    kodeSupplier: r.kode_supplier,
    namaSupplier: r.nama_supplier,
    kategori: r.kategori,
    warna: r.warna,
    hargaPerKg: Number(r.harga_per_kg),
  }));
  const hargaKainPks: HargaKainPksRow[] = (hargaKainPksRows.data ?? []).map((r) => ({
    id: r.id,
    kodeSupplier: r.kode_supplier,
    kategori: r.kategori,
    warna: r.warna,
    satuan: r.satuan,
    tonaseMin: r.tonase_min == null ? undefined : Number(r.tonase_min),
    tonaseMax: r.tonase_max == null ? undefined : Number(r.tonase_max),
    hargaPerKg: Number(r.harga_per_kg),
  }));
  const entitasList: EntitasRow[] = (entitasRows.data ?? []).map((r) => ({ id: r.id, nama: r.nama }));
  const supplierList: SupplierRow[] = (supplierRows.data ?? []).map((r) => ({ id: r.id, nama: r.nama }));

  return {
    mrpDetails,
    staticMrps,
    materialPOs,
    maklonPOs,
    invoices,
    maklonInvoices,
    productionBatches,
    productionResults,
    deliveryKolis,
    vendorInvoices,
    notifications,
    productionGroupMeta,
    rejectRemarks,
    materialClaimResolutions,
    materialClaimReturRequests,
    materialClaimReturDeliveries,
    materialClaimReturReceipts,
    materialClaimHistory,
    productionYieldResolutions,
    hargaMaklon,
    hargaKain,
    hargaKainPks,
    entitasList,
    supplierList,
    hydrated: true,
    // `busy` bukan bagian data Supabase -- ini murni flag client-side (lihat withBusyTracking di
    // lib/mrp/store.ts). Nilainya di sini tidak penting: hydrate()/refresh() selalu men-spread
    // snapshot penuh, tapi refresh() SENGAJA menyalin field lain (bukan busy) supaya tidak
    // menimpa flag yang lagi di-set true oleh action pemanggilnya -- lihat komentar di refresh().
    busy: false,
  };
}

function groupBy<T, K extends string | number>(rows: T[], keyFn: (row: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const row of rows) {
    const key = keyFn(row);
    (out[key] ??= []).push(row);
  }
  return out;
}
