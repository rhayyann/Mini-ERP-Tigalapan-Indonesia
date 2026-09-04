"use server";

// Server Actions untuk alur inti MRP -> PO -> Invoice -> Produksi -> Delivery -> Invoice Vendor.
//
// POLA YANG DIPAKAI DI SETIAP ACTION (lihat catatan keamanan di proxy.ts & docs Next.js
// guides/server-actions.md#security -- proxy TIDAK cukup untuk melindungi Server Function):
//   1. requireSession() / requireInternalRole() / requireVendorSession() di baris PALING AWAL.
//   2. Kalau perlu data lintas-entitas untuk kalkulasi (status turunan, target produksi, dst),
//      fetch snapshot penuh lewat getFlowSnapshot() dan pakai fungsi murni dari derive.ts APA
//      ADANYA (tidak ditulis ulang) -- persis logika yang dulu jalan di lib/mrp/store.ts, cuma
//      sumber datanya sekarang snapshot Supabase, bukan state Zustand in-memory.
//   3. Generate id (kalau perlu) lewat nextReadableId() SEBELUM langkah 2/4 (async, harus di luar
//      bagian yang meniru logika sinkron lama).
//   4. Tulis HANYA baris yang benar-benar berubah balik ke Supabase (bukan full-table resync).
//
// Business logic di sini mengikuti PERSIS lib/mrp/store.ts (dibaca penuh saat migrasi) -- lihat
// komentar di masing-masing fungsi kalau ada penyesuaian dari bentuk aslinya.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession, requireInternalRole, requireAnyInternalRole } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import { nextReadableId } from "./repo/ids";
import { getFlowSnapshot } from "./repo/snapshot";
import {
  localDateString,
  maklonAmountForLenganBuckets,
  maklonAmountForVendor,
  materialAmountForPo,
  materialClaimsList,
  materialPoFullStatus,
  splitMaterialPoByEntitas,
  advanceMaklonToDeliveryIfFullyDone,
  reassignAduanRowsVendor,
  cuttingSizesForGroup,
  actualCutSizesForGroup,
  reworkQtyForGroup,
  wasteQtyForGroup,
  cumulativeSizeQtyForGroup,
  weightVariance,
  movableRollCountForInvoice,
  warnaLenganGroupsWithFg,
} from "./derive";
import { ENTITAS_LIST } from "./seed";
import type { ParsedMrpImport } from "./parseImport";
import type { MrpDetail } from "./store";
import type {
  AddBuyItem,
  AduanPolaRow,
  ColorBreakdown,
  ColorEntry,
  DeliveryKoliItem,
  Lengan,
  MaklonPO,
  MaterialPO,
  MaterialRow,
  Notification,
  NotificationAudience,
  ProductionBatch,
  ProductionResult,
  RawMaterialInvoice,
  RollReceipt,
  Usia,
  VendorInvoiceAdjustmentKind,
} from "./types";

function today() {
  return localDateString(new Date());
}
function nowIso() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${localDateString(d)} ${hh}:${mm}`;
}
/** Jam saja ("HH:mm") -- persis helper now() lama di lib/mrp/store.ts, dipakai utk field
 *  `time` notifikasi & cancelledLines (lihat catatan tipe kolom di migrasi 0004). */
function nowClock() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

async function requireVendorSession(): Promise<string> {
  const session = await requireSession();
  if (!session.vendorId) throw new Error("Forbidden: aksi ini hanya untuk vendor produksi.");
  return session.vendorId;
}

async function insertNotification(n: Omit<Notification, "id"> & { id?: string }) {
  const id = n.id ?? (await nextReadableId("NTF"));
  const { error } = await supabaseServer()
    .from("notifications")
    .insert({ id, text: n.text, time: n.time, audience: n.audience, vendor_id: n.vendorId ?? null, read: n.read });
  if (error) throw new Error(`Gagal menyimpan notifikasi: ${error.message}`);
}

function notif(text: string, audience: NotificationAudience[], vendorId?: string): Omit<Notification, "id"> {
  return { text, time: nowClock(), audience, vendorId, read: false };
}

/** Sama seperti checkPoApproved di lib/mrp/store.ts lama -- kalau semua PO material & maklon
 *  milik satu MRP sudah approved/cancelled, catat tanggal PO Approved (sekali saja). */
async function checkPoApproved(mrpId: string) {
  const db = supabaseServer();
  const [materialRes, maklonRes, mrpRes] = await Promise.all([
    db.from("material_pos").select("approved,status").eq("mrp_id", mrpId),
    db.from("maklon_pos").select("approved").eq("mrp_id", mrpId),
    db.from("mrp").select("po_approved_at").eq("id", mrpId).single(),
  ]);
  if (materialRes.error || maklonRes.error || mrpRes.error) return;
  const materialDone = (materialRes.data ?? []).every((p) => p.approved || p.status === "CANCELLED");
  const maklonDone = (maklonRes.data ?? []).every((p) => p.approved);
  if (materialDone && maklonDone && !mrpRes.data?.po_approved_at) {
    await db.from("mrp").update({ po_approved_at: today() }).eq("id", mrpId);
  }
}

// =========================================================================
// MRP / import / approval
// =========================================================================

export async function importMrpAction(parsed: ParsedMrpImport, customId?: string): Promise<string> {
  await requireInternalRole(await requireSession(), "ppic");
  const db = supabaseServer();

  const id = customId?.trim() || (await nextReadableId("MRP"));
  const idMap = new Map<string, string>();
  const lenganGroups = parsed.lenganGroups.map((g) => {
    const newId = id + "-" + g.id;
    idMap.set(g.id, newId);
    return { ...g, id: newId };
  });
  const aduanRows = parsed.aduanRows.map((a, i) => ({ ...a, id: id + "-ad-" + i, lenganGroupId: idMap.get(a.lenganGroupId) ?? a.lenganGroupId }));
  const { data: entitasRows } = await db.from("entitas").select("nama").order("nama").limit(1);
  const defaultEntitas = entitasRows?.[0]?.nama ?? ENTITAS_LIST[0];
  const materialRows = parsed.materialRows.map((m) => ({ ...m, id: id + "-" + m.id, lenganGroupId: idMap.get(m.lenganGroupId) ?? m.lenganGroupId, entitas: defaultEntitas }));

  const { error: mrpErr } = await db.from("mrp").insert({
    id,
    kategori: parsed.kategori,
    warna: parsed.warna,
    target_date: "-",
    live: true,
    qty: parsed.qty,
    is_fob: parsed.isFob ?? false,
    ppic_approval: "WAITING_PPIC_APPROVAL",
    po_sent: false,
    created_at: today(),
    ppic_submitted_at: today(),
  });
  if (mrpErr) throw new Error(`Gagal membuat MRP: ${mrpErr.message}`);

  if (lenganGroups.length > 0) {
    await db.from("lengan_groups").insert(
      lenganGroups.map((g) => ({ id: g.id, mrp_id: id, warna: g.warna, lengan: g.lengan, total_qty: g.totalQty, rib_kg: g.ribKg, roll_estimate: g.rollEstimate, vendor_default: g.vendorDefault }))
    );
    const sizeRows = lenganGroups.flatMap((g) => g.sizes.map((s) => ({ lengan_group_id: g.id, size: s.size, qty: s.qty })));
    if (sizeRows.length > 0) await db.from("lengan_group_sizes").insert(sizeRows);
  }
  if (aduanRows.length > 0) {
    await db.from("aduan_pola_rows").insert(
      aduanRows.map((a) => ({ id: a.id, lengan_group_id: a.lenganGroupId, mrp_id: id, warna: a.warna, lengan: a.lengan, kode: a.kode, qty_roll: a.qtyRoll, qty: a.qty, vendor: a.vendor, rib_allocated_roll: a.ribAllocatedRoll ?? null }))
    );
    const aduanSizeRows = aduanRows.flatMap((a) => a.sizes.map((s) => ({ aduan_row_id: a.id, size: s.size, qty: s.qty })));
    if (aduanSizeRows.length > 0) await db.from("aduan_pola_sizes").insert(aduanSizeRows);
  }
  if (materialRows.length > 0) {
    await db.from("material_rows").insert(
      materialRows.map((m) => ({ id: m.id, lengan_group_id: m.lenganGroupId, mrp_id: id, warna: m.warna, lengan: m.lengan, qty_roll: m.qtyRoll, rib_kg: m.ribKg, supplier: m.supplier, entitas: m.entitas }))
    );
  }

  await insertNotification(notif(`MRP ${id} diajukan PPIC — menunggu approval SCM sebelum diproses Procurement`, ["scm"]));
  return id;
}

export async function approvePpicMrpAction(mrpId: string): Promise<void> {
  await requireInternalRole(await requireSession(), "scm");
  const db = supabaseServer();
  const { error } = await db.from("mrp").update({ ppic_approval: "PPIC_APPROVED", ppic_approved_at: today() }).eq("id", mrpId);
  if (error) throw new Error(error.message);
  await insertNotification(notif(`MRP ${mrpId} disetujui SCM — siap diproses Procurement`, ["ppic", "procurement"]));
}

/** Terima array materialRowIds (bukan satu id) -- 1 warna bisa punya beberapa baris (per lengan),
 *  dan dulu dipanggil sekali per baris lewat `.forEach()` di UI (page.tsx), masing-masing dengan
 *  refresh() snapshot penuhnya sendiri-sendiri -- selain lambat (N round-trip buat 1 klik), juga
 *  race condition (beberapa refresh() saling susul-menyusul, urutan selesainya tidak terjamin).
 *  Sekarang 1 UPDATE untuk semua baris sekaligus, 1 refresh() saja. */
export async function assignMaterialSupplierAction(mrpId: string, materialRowIds: string[], supplier: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  if (materialRowIds.length === 0) return;
  const { error } = await supabaseServer().from("material_rows").update({ supplier }).in("id", materialRowIds).eq("mrp_id", mrpId);
  if (error) throw new Error(error.message);
}

export async function assignMaterialEntitasAction(mrpId: string, materialRowId: string, entitas: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const { error } = await supabaseServer().from("material_rows").update({ entitas }).eq("id", materialRowId).eq("mrp_id", mrpId);
  if (error) throw new Error(error.message);
}

export async function switchAduanVendorAction(mrpId: string, aduanId: string, toVendor: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const { error } = await supabaseServer().from("aduan_pola_rows").update({ vendor: toVendor }).eq("id", aduanId).eq("mrp_id", mrpId);
  if (error) throw new Error(error.message);
}

export async function rejectPpicMrpAction(mrpId: string, reason: string): Promise<void> {
  await requireInternalRole(await requireSession(), "scm");
  const db = supabaseServer();
  const { error } = await db.from("mrp").update({ ppic_approval: "REJECTED", ppic_rejection_note: reason }).eq("id", mrpId);
  if (error) throw new Error(error.message);
  await insertNotification(notif(`MRP ${mrpId} DITOLAK SCM — alasan: ${reason}. Cek kembali datanya lalu impor ulang kalau perlu.`, ["ppic"]));
}

// =========================================================================
// PO generation / approval
// =========================================================================

export async function sendPoToFinanceAction(mrpId: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  // Targeted (bukan getFlowSnapshot() penuh): aduanRows/materialRows di-scope ke mrpId ini saja;
  // hargaMaklon/hargaKain/hargaKainPks/entitasList tabel lookup GLOBAL kecil, tetap di-fetch
  // penuh tapi cuma tabel-tabel itu (bukan 32 tabel seluruh app).
  const [aduanRows, materialRowsRes, hargaMaklonRes, harga, entitasRes] = await Promise.all([
    fetchAduanRowsForMrp(db, mrpId),
    db.from("material_rows").select("*").eq("mrp_id", mrpId),
    db.from("harga_maklon").select("*"),
    fetchHargaTables(db),
    db.from("entitas").select("*"),
  ]);
  if (aduanRows.length === 0) throw new Error("MRP tidak ditemukan.");
  const materialRows: MaterialRow[] = (materialRowsRes.data ?? []).map((r) => ({
    id: r.id,
    lenganGroupId: r.lengan_group_id,
    warna: r.warna,
    lengan: r.lengan,
    qtyRoll: Number(r.qty_roll),
    ribKg: Number(r.rib_kg),
    supplier: r.supplier,
    entitas: r.entitas ?? undefined,
  }));
  const hargaMaklon: HargaMaklonRow[] = (hargaMaklonRes.data ?? []).map((r) => ({
    id: r.id,
    kodeVendor: r.kode_vendor,
    namaVendor: r.nama_vendor,
    tipeLengan: r.tipe_lengan,
    jenisHarga: r.jenis_harga,
    kapasitasMin: r.kapasitas_min ?? undefined,
    kapasitasMax: r.kapasitas_max ?? undefined,
    harga: Number(r.harga),
  }));
  const entitasList: EntitasRow[] = (entitasRes.data ?? []).map((r) => ({ id: r.id, nama: r.nama }));

  const vendorRows = new Map<string, typeof aduanRows>();
  for (const a of aduanRows) vendorRows.set(a.vendor, [...(vendorRows.get(a.vendor) ?? []), a]);

  const maklonPoIds = await Promise.all(Array.from(vendorRows.keys()).map(() => nextReadableId("PO-MKL")));
  const maklonPOs = Array.from(vendorRows.entries()).map(([vendor, rows], idx) => ({
    id: maklonPoIds[idx],
    mrpId,
    vendorProduksi: vendor,
    qty: rows.reduce((s, r) => s + r.qty, 0),
    amount: maklonAmountForVendor(hargaMaklon, vendor, rows),
    entity: "Tigalapan Indonesia",
    status: "FULL_WAITING_MATERIAL" as const,
    approved: false,
  }));

  const pairTotals = new Map<string, { vendor: string; supplier: string; rolls: number; colorMap: Map<string, ColorBreakdown> }>();
  const defaultEntitas = entitasList[0]?.nama ?? ENTITAS_LIST[0];
  for (const a of aduanRows) {
    const mr = materialRows.find((m) => m.lenganGroupId === a.lenganGroupId);
    const supplier = mr?.supplier;
    if (!supplier) continue;
    const key = a.vendor + "|" + supplier;
    const cur = pairTotals.get(key) ?? { vendor: a.vendor, supplier, rolls: 0, colorMap: new Map<string, ColorBreakdown>() };
    cur.rolls += a.qtyRoll;
    const colorKey = a.warna + "|" + a.lengan;
    const cc = cur.colorMap.get(colorKey) ?? { warna: a.warna, lengan: a.lengan, rollCount: 0, entitas: mr!.entitas ?? defaultEntitas };
    cc.rollCount += a.qtyRoll;
    cur.colorMap.set(colorKey, cc);
    pairTotals.set(key, cur);
  }

  const materialPoIds = await Promise.all(Array.from(pairTotals.values()).map(() => nextReadableId("PO-SUP")));
  const materialPOs = Array.from(pairTotals.values()).map((p, idx) => {
    const colorBreakdown = Array.from(p.colorMap.values());
    const entitasCounts = new Map<string, number>();
    for (const c of colorBreakdown) entitasCounts.set(c.entitas ?? defaultEntitas, (entitasCounts.get(c.entitas ?? defaultEntitas) ?? 0) + c.rollCount);
    const majorityEntitas = Array.from(entitasCounts.entries()).sort((a2, b2) => b2[1] - a2[1])[0]?.[0] ?? defaultEntitas;
    return {
      id: materialPoIds[idx],
      mrpId,
      vendorProduksi: p.vendor,
      supplier: p.supplier,
      warna: colorBreakdown.length === 1 ? colorBreakdown[0].warna : colorBreakdown.map((c) => c.warna).join(", "),
      lengan: colorBreakdown[0].lengan,
      colorBreakdown,
      rollCount: p.rolls,
      amount: materialAmountForPo(harga.hargaKain, harga.hargaKainPks, p.supplier, colorBreakdown),
      entity: majorityEntitas,
    };
  });

  if (maklonPOs.length > 0) {
    await db.from("maklon_pos").insert(
      maklonPOs.map((p) => ({ id: p.id, mrp_id: p.mrpId, vendor_produksi: p.vendorProduksi, qty: p.qty, amount: p.amount, entity: p.entity, status: p.status, approved: p.approved }))
    );
  }
  if (materialPOs.length > 0) {
    await db.from("material_pos").insert(
      materialPOs.map((p) => ({
        id: p.id,
        mrp_id: p.mrpId,
        vendor_produksi: p.vendorProduksi,
        supplier: p.supplier,
        warna: p.warna,
        lengan: p.lengan,
        roll_count: p.rollCount,
        available_rolls: p.rollCount,
        invoiced_rolls: 0,
        amount: p.amount,
        entity: p.entity,
        status: "WAITING_INVOICE",
        approved: false,
        days_since_po: 0,
      }))
    );
    await db.from("material_po_color_breakdown").insert(
      materialPOs.flatMap((p) => p.colorBreakdown.map((c) => ({ material_po_id: p.id, warna: c.warna, lengan: c.lengan, roll_count: c.rollCount, entitas: c.entitas ?? null })))
    );
  }

  await db.from("mrp").update({ po_sent: true, po_sent_at: today() }).eq("id", mrpId);
  await insertNotification(notif(`PO untuk ${mrpId} dikirim ke Finance — ${materialPOs.length} PO material, ${maklonPOs.length} PO maklon`, ["finance"]));
}

/** Fetch SATU MaterialPO by id (+colorBreakdown & invoicedByColor-nya) -- targeted 3-tabel query
 *  paralel, bukan getFlowSnapshot() penuh (32 tabel). Pemetaan kolom persis
 *  lib/mrp/repo/snapshot.ts (dibaca ulang saat menulis ini) supaya bentuk objeknya identik dengan
 *  yang dulu dari snapshot -- caller-nya (splitMaterialPoByEntitas dkk, semua fungsi murni di
 *  derive.ts) tidak berubah sama sekali. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMaterialPoRow(p: any, colorRows: any[], invoicedRows: any[]): MaterialPO {
  const colorBreakdown: ColorBreakdown[] = colorRows.map((c) => ({
    warna: c.warna,
    lengan: c.lengan,
    rollCount: Number(c.roll_count),
    entitas: c.entitas ?? undefined,
  }));
  const invoicedByColor: Record<string, number> = {};
  for (const row of invoicedRows) invoicedByColor[row.color_key] = Number(row.invoiced_rolls);
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
}

async function fetchOneMaterialPo(db: SupabaseClient, id: string): Promise<MaterialPO | undefined> {
  const [poRes, colorRes, invoicedRes] = await Promise.all([
    db.from("material_pos").select("*").eq("id", id).maybeSingle(),
    db.from("material_po_color_breakdown").select("*").eq("material_po_id", id),
    db.from("material_po_invoiced_by_color").select("*").eq("material_po_id", id),
  ]);
  if (!poRes.data) return undefined;
  return mapMaterialPoRow(poRes.data, colorRes.data ?? [], invoicedRes.data ?? []);
}

/** Fetch materialPOs yang cocok filter (mis. belum approved & belum cancelled, untuk 1
 *  mrp+vendor atau seluruh app) -- 3 query (bukan getFlowSnapshot() 32-tabel): baris PO yang
 *  match `whereApproved`/`whereMrpVendor`, LALU color-breakdown/invoiced-by-color-nya di-scope
 *  ke id PO yang ketemu itu saja (`.in("material_po_id", ids)`). Dipakai
 *  approveAllMaterialPosAction (seluruh app) & approveVendorMaterialPosAction (1 mrp+vendor). */
async function fetchUnapprovedMaterialPos(db: SupabaseClient, scope: { mrpId: string; vendorProduksi: string } | undefined): Promise<MaterialPO[]> {
  let q = db.from("material_pos").select("*").eq("approved", false).neq("status", "CANCELLED");
  if (scope) q = q.eq("mrp_id", scope.mrpId).eq("vendor_produksi", scope.vendorProduksi);
  const poRes = await q;
  const rows = poRes.data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [colorRes, invoicedRes] = await Promise.all([
    db.from("material_po_color_breakdown").select("*").in("material_po_id", ids),
    db.from("material_po_invoiced_by_color").select("*").in("material_po_id", ids),
  ]);
  const colorByPo = new Map<string, typeof colorRes.data>();
  for (const c of colorRes.data ?? []) colorByPo.set(c.material_po_id, [...(colorByPo.get(c.material_po_id) ?? []), c]);
  const invoicedByPo = new Map<string, typeof invoicedRes.data>();
  for (const i of invoicedRes.data ?? []) invoicedByPo.set(i.material_po_id, [...(invoicedByPo.get(i.material_po_id) ?? []), i]);
  return rows.map((p) => mapMaterialPoRow(p, colorByPo.get(p.id) ?? [], invoicedByPo.get(p.id) ?? []));
}

export async function approveMaterialPoAction(id: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const po = await fetchOneMaterialPo(db, id);
  if (!po) return;

  const distinctEntitas = new Set(po.colorBreakdown.map((c) => c.entitas ?? po.entity));
  const newIds = await Promise.all(Array.from({ length: Math.max(0, distinctEntitas.size - 1) }).map(() => nextReadableId("PO-SUP")));
  const parts = splitMaterialPoByEntitas(po, newIds).map((p) => ({ ...p, approved: true }));

  await writeMaterialPoSplit(db, id, parts);
  await checkPoApproved(po.mrpId);
}

/** Dipakai approveMaterialPoAction: kalau splitMaterialPoByEntitas menghasilkan >1 PO baru,
 *  hapus PO lama & insert semua bagian hasil split (dengan children color_breakdown +
 *  invoiced_by_color-nya) -- kalau cuma 1 bagian (tidak ke-split), cukup UPDATE approved=true. */
async function writeMaterialPoSplit(db: ReturnType<typeof supabaseServer>, originalId: string, parts: MaterialPO[]) {
  if (parts.length === 1 && parts[0].id === originalId) {
    await db.from("material_pos").update({ approved: true }).eq("id", originalId);
    return;
  }
  await db.from("material_pos").delete().eq("id", originalId);
  await db.from("material_pos").insert(
    parts.map((p) => ({
      id: p.id,
      mrp_id: p.mrpId,
      vendor_produksi: p.vendorProduksi,
      supplier: p.supplier,
      warna: p.warna,
      lengan: p.lengan,
      roll_count: p.rollCount,
      available_rolls: p.availableRolls,
      invoiced_rolls: p.invoicedRolls,
      amount: p.amount,
      entity: p.entity,
      status: p.status,
      approved: p.approved,
      days_since_po: p.daysSincePO,
    }))
  );
  await db.from("material_po_color_breakdown").insert(
    parts.flatMap((p) => p.colorBreakdown.map((c) => ({ material_po_id: p.id, warna: c.warna, lengan: c.lengan, roll_count: c.rollCount, entitas: c.entitas ?? null })))
  );
  const invoicedRows = parts.flatMap((p) => Object.entries(p.invoicedByColor).map(([colorKey, rolls]) => ({ material_po_id: p.id, color_key: colorKey, invoiced_rolls: rolls })));
  if (invoicedRows.length > 0) await db.from("material_po_invoiced_by_color").insert(invoicedRows);
}

export async function approveMaklonPoAction(id: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const { data: po, error } = await db.from("maklon_pos").select("id,mrp_id,vendor_produksi").eq("id", id).single();
  if (error || !po) return;
  // Approve HANYA mengubah `approved` -- status FULL/PARTIAL_WAITING_MATERIAL dipertahankan
  // apa adanya (lihat komentar asli di lib/mrp/store.ts, bug lama pernah overwrite ke PARTIAL).
  await db.from("maklon_pos").update({ approved: true }).eq("id", id);
  await insertNotification(notif(`PO Produksi ${po.id} untuk ${po.mrp_id} telah disetujui Finance — cek menu PO Produksi Saya`, ["vendorMaklon"], po.vendor_produksi));
  await checkPoApproved(po.mrp_id);
}

// =========================================================================
// Invoicing (raw material)
// =========================================================================

export async function bookInvoiceAction(
  poId: string,
  input: { colorEntries: ColorEntry[]; addBuys: AddBuyItem[]; diskon: number; kodeTransaksi: string; noInvoiceVendor: string; buktiPvDataUrl?: string; buktiPvFileName?: string }
): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const { data: po, error: poErr } = await db.from("material_pos").select("*").eq("id", poId).single();
  if (poErr || !po) throw new Error("PO material tidak ditemukan.");

  const qtyReady = input.colorEntries.reduce((a, c) => a + c.rolls.length, 0);
  const materialTotal = input.colorEntries.reduce((a, c) => a + c.hargaPerRoll * c.rolls.reduce((s, w) => s + w, 0), 0);
  const addBuyTotal = input.addBuys.reduce((a, b) => a + b.totalHarga, 0);
  const totalBiaya = materialTotal + addBuyTotal - input.diskon;
  const invoiceId = await nextReadableId("INV");

  const { error: insErr } = await db.from("raw_material_invoices").insert({
    id: invoiceId,
    po_id: poId,
    mrp_id: po.mrp_id,
    vendor_produksi: po.vendor_produksi,
    supplier: po.supplier,
    qty_ready: qtyReady,
    diskon: input.diskon,
    total_biaya: totalBiaya,
    kode_transaksi: input.kodeTransaksi,
    no_invoice_vendor: input.noInvoiceVendor,
    entity: po.entity,
    status: "INVOICED",
    destination_vendor: po.vendor_produksi,
    booked_at: today(),
    bukti_pv_storage_path: input.buktiPvDataUrl ?? null,
    bukti_pv_file_name: input.buktiPvFileName ?? null,
  });
  if (insErr) throw new Error(`Gagal booking invoice: ${insErr.message}`);

  for (const c of input.colorEntries) {
    const colorId = `${invoiceId}-${c.warna}-${c.lengan}`;
    await db.from("raw_material_invoice_colors").insert({ id: colorId, invoice_id: invoiceId, warna: c.warna, lengan: c.lengan, harga_per_roll: c.hargaPerRoll });
    if (c.rolls.length > 0) {
      await db.from("raw_material_invoice_rolls").insert(c.rolls.map((grossKg, idx) => ({ invoice_color_id: colorId, roll_index: idx, gross_kg: grossKg })));
    }
  }
  if (input.addBuys.length > 0) {
    await db
      .from("raw_material_invoice_addbuys")
      .insert(input.addBuys.map((b) => ({ id: b.id, invoice_id: invoiceId, item: b.item, warna: b.warna || null, berat_kg: b.beratKg, harga_per_kg: b.hargaPerKg ?? null, total_harga: b.totalHarga, remark: b.remark || null })));
  }

  const invoicedByColor: Record<string, number> = {};
  for (const c of input.colorEntries) {
    const key = `${c.warna}|${c.lengan}`;
    invoicedByColor[key] = c.rolls.length;
  }
  const { data: existingInvoiced } = await db.from("material_po_invoiced_by_color").select("color_key,invoiced_rolls").eq("material_po_id", poId);
  for (const [colorKey, addRolls] of Object.entries(invoicedByColor)) {
    const prior = existingInvoiced?.find((r) => r.color_key === colorKey)?.invoiced_rolls ?? 0;
    await db.from("material_po_invoiced_by_color").upsert({ material_po_id: poId, color_key: colorKey, invoiced_rolls: prior + addRolls });
  }
  const newInvoicedRolls = Number(po.invoiced_rolls) + qtyReady;
  await db
    .from("material_pos")
    .update({ invoiced_rolls: newInvoicedRolls, status: newInvoicedRolls >= Number(po.roll_count) ? "INVOICE" : po.status })
    .eq("id", poId);

  // Kunci alokasi roll Aduan Pola per warna (rib_allocated_roll) -- persis logika asli.
  const rollsByWarna = new Map<string, number>();
  for (const c of input.colorEntries) rollsByWarna.set(c.warna, (rollsByWarna.get(c.warna) ?? 0) + c.rolls.length);
  const { data: aduanRows } = await db.from("aduan_pola_rows").select("id,warna,qty_roll,rib_allocated_roll").eq("mrp_id", po.mrp_id);
  if (aduanRows) {
    for (const [warna, rollQty] of rollsByWarna.entries()) {
      let remainingQty = rollQty;
      for (const a of aduanRows) {
        if (remainingQty <= 0 || a.warna !== warna) continue;
        const avail = Number(a.qty_roll) - Number(a.rib_allocated_roll ?? 0);
        if (avail <= 0) continue;
        const use = Math.min(avail, remainingQty);
        remainingQty -= use;
        await db.from("aduan_pola_rows").update({ rib_allocated_roll: Number(a.rib_allocated_roll ?? 0) + use }).eq("id", a.id);
      }
    }
  }

  const { data: mrpRow } = await db.from("mrp").select("first_invoice_at").eq("id", po.mrp_id).single();
  if (mrpRow && !mrpRow.first_invoice_at) await db.from("mrp").update({ first_invoice_at: today() }).eq("id", po.mrp_id);
}

export async function transferMaterialAction(items: { invoiceId: string; qty: number }[], toVendor: string, deliveryDate: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const snapshot = await getFlowSnapshot();

  for (const { invoiceId, qty } of items) {
    const inv = snapshot.invoices.find((i) => i.id === invoiceId);
    if (!inv) continue;
    const fromVendor = inv.destinationVendor;
    if (fromVendor === toVendor) continue;
    // Item 1 (feedback batch 2026-09-04): transfer sekarang dibolehkan sampai tahap PRODUCTION
    // (dulu diblokir dari PRODUCTION ke atas) -- batas baru cuma begitu material sudah masuk
    // FINISH_GOOD (barang jadi, bukan roll lagi) ke atas. UI (Material Tracking) sudah menyaring
    // ini dari daftar yang bisa dipilih, dicek lagi di sini sebagai jaring pengaman kalau ada yang
    // lolos.
    const po = snapshot.materialPOs.find((p) => p.id === inv.poId);
    if (po) {
      const status = materialPoFullStatus(po, snapshot.invoices, snapshot.productionBatches, snapshot.productionResults, snapshot.mrpDetails, snapshot.deliveryKolis, snapshot.vendorInvoices, snapshot.maklonPOs);
      if (["FINISH_GOOD", "DELIVERED_FROM_VENDOR", "SELESAI"].includes(status)) continue;
    }
    // Item 1.4: karena transfer sekarang dibolehkan SAMPAI tahap PRODUCTION, roll yang code_roll-
    // nya SUDAH dipakai suatu ProductionBatch (sudah benar-benar dipotong) tidak boleh ikut
    // pindah -- clamp moveQty ke movableRollCountForInvoice (exclusion logic sama seperti
    // availableCodeRollsForColor), skip invoice ini sama sekali kalau movable-nya 0.
    const movableCount = movableRollCountForInvoice(inv, snapshot.productionBatches);
    const moveQty = Math.max(0, Math.min(qty, inv.qtyReady, movableCount));
    if (moveQty <= 0) continue;

    let remaining = moveQty;
    const movedColorEntries: ColorEntry[] = [];
    const keptColorEntries: ColorEntry[] = [];
    // Item 1.4: roll_index ASLI (di DB) yang benar-benar ikut pindah per warna|lengan -- BUKAN
    // lagi selalu 0..N-1 seperti dulu (dulu moved SELALU N roll pertama), karena sekarang roll
    // yang movableIdx-nya bisa "berlubang" (mis. index 0 dipakai batch, yang movable 1 & 2).
    // Dipakai di bawah untuk DELETE by-index yang benar (bukan asumsi range kontigu).
    const movedIdxByColor = new Map<string, number[]>();
    for (const c of inv.colorEntries) {
      if (remaining <= 0) {
        keptColorEntries.push(c);
        continue;
      }
      const key = c.warna + "|" + c.lengan;
      const receipts = inv.rollReceipts[key] ?? [];
      const usedCodeRolls = new Set(
        snapshot.productionBatches
          .filter((b) => b.mrpId === inv.mrpId && b.vendorProduksi === fromVendor && b.warna === c.warna && b.lengan === c.lengan && b.codeRoll)
          .map((b) => b.codeRoll!)
      );
      // Pilih index roll yang MOVABLE saja (code_roll belum dipakai batch manapun) -- bukan lagi
      // sekadar "N roll pertama" seperti dulu, supaya roll yang sudah dipotong tidak pernah ikut
      // kepilih walau ada roll movable di belakangnya.
      const movableIdx: number[] = [];
      for (let idx = 0; idx < c.rolls.length; idx++) {
        const cr = receipts[idx]?.codeRoll;
        if (cr && usedCodeRolls.has(cr)) continue;
        movableIdx.push(idx);
      }
      const takeCount = Math.min(remaining, movableIdx.length);
      const takeIdx = new Set(movableIdx.slice(0, takeCount));
      const movedRolls: number[] = [];
      const keptRolls: number[] = [];
      for (let idx = 0; idx < c.rolls.length; idx++) {
        if (takeIdx.has(idx)) movedRolls.push(c.rolls[idx]);
        else keptRolls.push(c.rolls[idx]);
      }
      if (movedRolls.length > 0) {
        movedColorEntries.push({ ...c, rolls: movedRolls });
        movedIdxByColor.set(key, Array.from(takeIdx).sort((a, b) => a - b));
      }
      if (keptRolls.length > 0) keptColorEntries.push({ ...c, rolls: keptRolls });
      remaining -= takeCount;
    }
    const actualMoved = moveQty - remaining;
    if (actualMoved <= 0) continue;

    const detail = snapshot.mrpDetails.find((d) => d.mrp.id === inv.mrpId);
    let pcsMoved = 0;
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
      const splitCount = nextAduanRows.filter((a) => a.vendor === fromVendor && a.warna === c.warna && a.lengan === c.lengan).length;
      const newAduanIds = await Promise.all(Array.from({ length: splitCount }).map(() => nextReadableId("AD")));
      nextAduanRows = reassignAduanRowsVendor(nextAduanRows, fromVendor, toVendor, c.warna, c.lengan, c.rolls.length, newAduanIds);
    }

    // Tulis balik baris aduan pola yang berubah (vendor pindah, atau row baru hasil split).
    if (detail) {
      const before = new Map(detail.aduanRows.map((a) => [a.id, a]));
      for (const a of nextAduanRows) {
        const prev = before.get(a.id);
        if (!prev) {
          await db.from("aduan_pola_rows").insert({ id: a.id, lengan_group_id: a.lenganGroupId, mrp_id: inv.mrpId, warna: a.warna, lengan: a.lengan, kode: a.kode, qty_roll: a.qtyRoll, qty: a.qty, vendor: a.vendor, rib_allocated_roll: a.ribAllocatedRoll ?? null });
          if (a.sizes.length > 0) await db.from("aduan_pola_sizes").insert(a.sizes.map((s) => ({ aduan_row_id: a.id, size: s.size, qty: s.qty })));
        } else if (prev.vendor !== a.vendor || prev.qtyRoll !== a.qtyRoll || prev.qty !== a.qty) {
          await db.from("aduan_pola_rows").update({ vendor: a.vendor, qty_roll: a.qtyRoll, qty: a.qty }).eq("id", a.id);
        }
      }
    }

    if (keptColorEntries.length === 0) {
      // BUG lama: baris raw_material_invoice_rolls di-DELETE tanpa pernah di-insert ulang —
      // invoice yang sama tetap dipakai (cuma destination_vendor-nya diganti), jadi gross_kg tiap
      // roll (dari invoice supplier asli) semestinya TIDAK berubah sama sekali saat material
      // dipindah antar vendor produksi. Akibatnya colorEntries[].rolls invoice ini jadi kosong
      // selamanya di Good Receive vendor tujuan ("BEIGE 24S · PANJANG (0 roll)" walau qty_ready-nya
      // tetap 4) — tidak ada apa-apa lagi yang bisa ditimbang/di-cutting untuk warna itu. Yang
      // benar: RESET saja kolom-kolom hasil timbang vendor SEBELUMNYA (net_kg, code_roll/lot,
      // status klaim) supaya vendor baru menimbang ulang dari awal, tapi roll_index & gross_kg
      // (data invoice asli dari supplier) tetap dipertahankan.
      // Item 1.5: cabang ini (SELURUH roll invoice ikut pindah) cuma bisa kejadian kalau
      // movableCount di atas mencakup semua roll invoice ini -- artinya TIDAK ADA roll di invoice
      // ini yang sudah dipakai batch (kalau ada, moveQty di-clamp jadi lebih kecil dari qtyReady,
      // sehingga keptColorEntries pasti tidak kosong). Jadi RESET total di sini tetap benar/aman.
      await db
        .from("raw_material_invoice_rolls")
        .update({
          net_kg: null,
          received_at: null,
          code_roll: null,
          code_lot: null,
          claim_resolved_note: null,
          claim_resolved_at: null,
          claim_retur_note: null,
          claim_retur_requested_at: null,
          weigh_confirmed_at: null,
          claim_photo_at: null,
        })
        .in("invoice_color_id", inv.colorEntries.map((c) => `${inv.id}-${c.warna}-${c.lengan}`));
      await db.from("raw_material_invoice_addbuys").update({ received_at: null }).eq("invoice_id", inv.id);
      await db
        .from("raw_material_invoices")
        .update({ destination_vendor: toVendor, status: "DELIVERY", delivered_at: deliveryDate, received_at: null, production_start: null, production_end: null })
        .eq("id", inv.id);
    } else {
      const keptCount = keptColorEntries.reduce((a, c) => a + c.rolls.length, 0);
      await db.from("raw_material_invoices").update({ qty_ready: keptCount }).eq("id", inv.id);
      for (const c of movedColorEntries) {
        const colorId = `${inv.id}-${c.warna}-${c.lengan}`;
        // Item 1.4: pakai roll_index ASLI yang benar-benar dipindah (movedIdxByColor), BUKAN
        // asumsi "N roll pertama" -- roll yang sudah dipakai batch bisa membuat movable index
        // berlubang (mis. 1,2 dipindah, 0 tetap karena sudah dipotong).
        const movedIdx = movedIdxByColor.get(c.warna + "|" + c.lengan) ?? [];
        await db.from("raw_material_invoice_rolls").delete().eq("invoice_color_id", colorId).in("roll_index", movedIdx);
        // Sisa roll yang TIDAK ikut pindah kehilangan kontinuitas roll_index (dulu mis. 2,3,4,5
        // setelah 0,1 dihapus) -- geser ulang ke 0..N-1 supaya tetap kompatibel dengan cara
        // receiveRawMaterialRollAction mengacu roll_index sebagai posisi array di UI.
        const { data: remainingRolls } = await db.from("raw_material_invoice_rolls").select("id,roll_index").eq("invoice_color_id", colorId).order("roll_index", { ascending: true });
        for (let i = 0; i < (remainingRolls ?? []).length; i++) {
          const r = remainingRolls![i];
          if (r.roll_index !== i) await db.from("raw_material_invoice_rolls").update({ roll_index: i }).eq("id", r.id);
        }
      }
      const newInvoiceId = await nextReadableId("INV");
      await db.from("raw_material_invoices").insert({
        id: newInvoiceId,
        po_id: inv.poId,
        mrp_id: inv.mrpId,
        vendor_produksi: inv.vendorProduksi,
        supplier: inv.supplier,
        qty_ready: actualMoved,
        diskon: 0,
        total_biaya: inv.totalBiaya,
        kode_transaksi: inv.kodeTransaksi,
        no_invoice_vendor: inv.noInvoiceVendor,
        entity: inv.entity,
        status: "DELIVERY",
        destination_vendor: toVendor,
        booked_at: today(),
        delivered_at: deliveryDate,
      });
      for (const c of movedColorEntries) {
        const colorId = `${newInvoiceId}-${c.warna}-${c.lengan}`;
        await db.from("raw_material_invoice_colors").insert({ id: colorId, invoice_id: newInvoiceId, warna: c.warna, lengan: c.lengan, harga_per_roll: c.hargaPerRoll });
        await db.from("raw_material_invoice_rolls").insert(c.rolls.map((grossKg, idx) => ({ invoice_color_id: colorId, roll_index: idx, gross_kg: grossKg })));
      }
    }

    if (pcsMoved > 0) {
      const fromMaklon = snapshot.maklonPOs.find((m) => m.mrpId === inv.mrpId && m.vendorProduksi === fromVendor);
      if (fromMaklon) {
        const newQty = Math.max(0, fromMaklon.qty - pcsMoved);
        await db.from("maklon_pos").update({ qty: newQty, amount: fromMaklon.qty > 0 ? Math.round((fromMaklon.amount / fromMaklon.qty) * newQty) : 0 }).eq("id", fromMaklon.id);
        await db.from("maklon_po_cancelled_lines").insert({ maklon_po_id: fromMaklon.id, note: `Material dipindahkan ke vendor lain`, rolls: actualMoved, pcs: pcsMoved, from_vendor: "Procurement", time: nowClock() });
      }
      const toMaklon = snapshot.maklonPOs.find((m) => m.mrpId === inv.mrpId && m.vendorProduksi === toVendor);
      if (toMaklon) {
        const newQty = toMaklon.qty + pcsMoved;
        await db.from("maklon_pos").update({ qty: newQty, amount: toMaklon.qty > 0 ? Math.round((toMaklon.amount / toMaklon.qty) * newQty) : pcsMoved * 7000 }).eq("id", toMaklon.id);
        await db.from("maklon_po_cancelled_lines").insert({ maklon_po_id: toMaklon.id, note: `Material diterima dari vendor lain`, rolls: actualMoved, pcs: pcsMoved, from_vendor: "Procurement", time: nowClock() });
      } else {
        const newMaklonId = await nextReadableId("PO-MKL");
        await db.from("maklon_pos").insert({
          id: newMaklonId,
          mrp_id: inv.mrpId,
          vendor_produksi: toVendor,
          qty: pcsMoved,
          amount: maklonAmountForLenganBuckets(snapshot.hargaMaklon, toVendor, Array.from(pcsMovedByLengan.entries()).map(([lengan, q]) => ({ lengan, qty: q }))),
          entity: "Tigalapan Indonesia",
          status: "PARTIAL_WAITING_MATERIAL",
          approved: true,
        });
        await db.from("maklon_po_cancelled_lines").insert({ maklon_po_id: newMaklonId, note: `Material diterima dari vendor lain`, rolls: actualMoved, pcs: pcsMoved, from_vendor: "Procurement", time: nowClock() });
      }
    }

    await insertNotification(notif(`${actualMoved} roll (${pcsMoved} pcs) material ${inv.mrpId} dipindahkan antar vendor`, ["procurement", "finance"]));
    await insertNotification(notif(`PO Produksi Anda berkurang ${pcsMoved} pcs — sebagian material dipindahkan ke vendor lain`, ["vendorMaklon"], fromVendor));
    await insertNotification(notif(`PO Produksi Anda bertambah ${pcsMoved} pcs — menerima material dipindahkan dari vendor lain`, ["vendorMaklon"], toVendor));
  }
}

export async function setInvoicesPaidAction(invoiceIds: string[], paid: boolean): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const { data: invoices } = await db.from("raw_material_invoices").select("id,status,po_id").in("id", invoiceIds);
  for (const inv of invoices ?? []) {
    if (paid && inv.status === "INVOICED") await db.from("raw_material_invoices").update({ status: "PAID", paid_at: today() }).eq("id", inv.id);
    // Item 2: "Batalkan Bayar" SENGAJA tidak menghapus invoice_payment_proofs -- file itu bukti
    // audit yang sudah pernah diserahkan, dan Status pill sudah cukup menunjukkan status aslinya
    // sekarang (INVOICED lagi). Menghapusnya cuma menghilangkan jejak tanpa manfaat.
    if (!paid && inv.status === "PAID") await db.from("raw_material_invoices").update({ status: "INVOICED", paid_at: null }).eq("id", inv.id);
  }
  if (paid && invoices && invoices.length > 0) {
    const { data: po } = await db.from("material_pos").select("mrp_id").eq("id", invoices[0].po_id).single();
    if (po) {
      const { data: mrpRow } = await db.from("mrp").select("first_payment_at").eq("id", po.mrp_id).single();
      if (mrpRow && !mrpRow.first_payment_at) await db.from("mrp").update({ first_payment_at: today() }).eq("id", po.mrp_id);
    }
  }
}

/** Item 2.5: Finance melampirkan bukti pembayaran (PDF) untuk 1+ invoice sekaligus -- diterima
 *  sebagai array karena satu transfer bank sering melunasi beberapa invoice sekaligus, jadi 1
 *  file yang sama perlu nempel ke semua invoice itu dalam SATU round-trip (alur kerja Finance
 *  yang sebenarnya), bukan upload berulang per invoice. */
export async function setInvoicePaymentProofAction(invoiceIds: string[], dataUrl: string, fileName?: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const uploadedAt = nowIso();
  for (const invoiceId of invoiceIds) {
    const { error: proofErr } = await db.from("invoice_payment_proofs").upsert({
      invoice_id: invoiceId,
      data_url: dataUrl,
      file_name: fileName ?? null,
      uploaded_at: uploadedAt,
    });
    if (proofErr) throw new Error(`Gagal menyimpan bukti pembayaran: ${proofErr.message}`);
    const { error: invErr } = await db
      .from("raw_material_invoices")
      .update({ bukti_bayar_at: uploadedAt, bukti_bayar_file_name: fileName ?? null })
      .eq("id", invoiceId);
    if (invErr) throw new Error(invErr.message);
  }
}

/** Item 2.5: ambil BYTE bukti pembayaran 1 invoice on-demand -- `invoice_payment_proofs` sengaja
 *  DIKELUARKAN dari get_flow_snapshot_raw() (migration 0017) supaya payloadnya tidak ikut
 *  re-download di setiap refresh snapshot. Dibaca Finance MAUPUN Procurement (Procurement
 *  menyerahkan bukti ini ke vendor material). */
export async function getInvoicePaymentProofAction(invoiceId: string): Promise<{ dataUrl: string; fileName?: string } | null> {
  await requireAnyInternalRole(await requireSession(), ["finance", "procurement"]);
  const db = supabaseServer();
  const { data } = await db.from("invoice_payment_proofs").select("data_url,file_name").eq("invoice_id", invoiceId).maybeSingle();
  if (!data) return null;
  return { dataUrl: data.data_url, fileName: data.file_name ?? undefined };
}

export async function setInvoicesDeliveryAction(invoiceIds: string[], deliveryDate: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const { data: invoices } = await db.from("raw_material_invoices").select("id,status").in("id", invoiceIds);
  for (const inv of invoices ?? []) {
    if (inv.status === "PAID") await db.from("raw_material_invoices").update({ status: "DELIVERY", delivered_at: deliveryDate }).eq("id", inv.id);
  }
}

/** Tandai 1 roll FISIK DITERIMA di Good Receive — TIDAK menimbang (lihat
 *  receiveRawMaterialRollAction untuk itu, sekarang dipanggil dari halaman Cutting). Ini yang
 *  memindahkan status invoice DELIVERY → RECEIVING (dulu dipicu oleh penimbangan roll pertama). */
export async function markRollArrivedAction(invoiceId: string, warna: string, lengan: Lengan, rollIndex: number, codeRoll?: string, codeLot?: string): Promise<void> {
  const vendorId = await requireVendorSession();
  const db = supabaseServer();
  const colorId = `${invoiceId}-${warna}-${lengan}`;
  const { error } = await db
    .from("raw_material_invoice_rolls")
    .update({ received_at: today(), code_roll: codeRoll ?? null, code_lot: codeLot ?? null })
    .eq("invoice_color_id", colorId)
    .eq("roll_index", rollIndex);
  if (error) throw new Error(error.message);

  const { data: inv } = await db.from("raw_material_invoices").select("id,status,received_at").eq("id", invoiceId).single();
  if (inv) {
    await db
      .from("raw_material_invoices")
      .update({ status: inv.status === "DELIVERY" ? "RECEIVING" : inv.status, received_at: inv.received_at ?? today() })
      .eq("id", invoiceId);
  }
  void vendorId;
}

/** Timbang 1 roll yang SUDAH ditandai diterima — dipanggil dari halaman Cutting (lihat
 *  pendingWeighRolls). Code roll biasanya sudah diisi saat markRollArrivedAction dan tidak
 *  diubah lagi di sini, KECUALI roll ini sedang ditimbang ulang setelah retur (`codeRoll`
 *  diisi) -- roll penggantinya bisa saja punya code roll fisik yang berbeda dari roll lama.
 *
 *  Roll yang masih punya klaim selisih berat AKTIF (di luar toleransi, belum diselesaikan) DIKUNCI
 *  di sini juga (bukan cuma di UI) -- tidak boleh ditimbang ulang sampai Procurement atur retur &
 *  vendor konfirmasi roll pengganti sudah diterima (`claim_retur_received_at` terisi), sesuai
 *  alur di app/procurement/material-claims/page.tsx. Vendor secara fisik tidak boleh "memperbaiki"
 *  angka roll yang salah kirim/rusak begitu saja -- harus lewat proses retur beneran. */
export async function receiveRawMaterialRollAction(
  invoiceId: string,
  warna: string,
  lengan: Lengan,
  rollIndex: number,
  netKg: number,
  claim?: { diffKg: number; pct: number },
  codeRoll?: string,
  photo?: { dataUrl: string; fileName?: string }
): Promise<void> {
  const vendorId = await requireVendorSession();
  const db = supabaseServer();
  const colorId = `${invoiceId}-${warna}-${lengan}`;
  const { data: rollRow } = await db
    .from("raw_material_invoice_rolls")
    .select("code_roll,code_lot,gross_kg,net_kg,claim_resolved_at,claim_retur_received_at")
    .eq("invoice_color_id", colorId)
    .eq("roll_index", rollIndex)
    .single();

  if (rollRow && rollRow.net_kg != null && rollRow.gross_kg != null) {
    // Item 4.4: SEKARANG cuma roll yang lebih RINGAN dari toleransi ("claimable") yang mengunci --
    // lebih berat dari invoice bukan klaim, tidak pernah bikin roll terkunci.
    const variance = weightVariance(Number(rollRow.gross_kg), Number(rollRow.net_kg));
    const isActiveClaim = variance.claimable && !rollRow.claim_resolved_at;
    if (isActiveClaim && !rollRow.claim_retur_received_at) {
      throw new Error(
        "Roll ini masih diklaim selisih berat -- menunggu Procurement atur retur & kirim roll pengganti (lihat Klaim Material). Konfirmasi 'diterima' dulu di sini setelah roll penggantinya sampai, baru bisa ditimbang ulang."
      );
    }
  }

  // Item 13: setiap kali roll ini ditimbang (baik pertama kali, edit di "Sudah ditimbang - belum
  // dikonfirmasi", ATAU claim baru dari roll yang tadinya SUDAH dikonfirmasi -- item 13.6) status
  // konfirmasinya SELALU kembali kosong -- cuma confirmRollWeighAction yang boleh mengisinya lagi.
  const update: Record<string, unknown> = { net_kg: netKg, weigh_confirmed_at: null };
  if (codeRoll && codeRoll.trim()) update.code_roll = codeRoll.trim();
  const claimKey = `${invoiceId}|${warna}|${lengan}|${rollIndex}`;
  if (!claim) {
    // Ditimbang & hasilnya sekarang sesuai toleransi (atau lebih BERAT dari invoice, item 4 --
    // disimpan normal, bukan klaim) -- kalau roll ini tadinya diklaim, klaimnya resmi tuntas di
    // sini. Bersihkan sisa catatan retur lama supaya tidak nyangkut/orphan kalau roll_index yang
    // sama suatu saat kena klaim lagi (baris baru harus mulai dari "BELUM"). Foto bukti (item 2/3)
    // TETAP ADA di material_claim_photos (arsip klaim lama), cuma flag di roll ini yang dibersihkan.
    update.claim_retur_note = null;
    update.claim_retur_requested_at = null;
    update.claim_retur_delivered_note = null;
    update.claim_retur_delivered_at = null;
    update.claim_retur_received_at = null;
    update.claim_resolved_note = null;
    update.claim_resolved_at = null;
    update.claim_photo_at = null;
  } else if (photo) {
    // Validasi server-side -- kompresi/ukuran/tipe gambar di client (production-cutting-tab.tsx)
    // cuma konvensi UI, siapa pun yang manggil Server Action ini langsung (skip UI) bisa kirim
    // string apa saja. Tanpa cek ini, string non-gambar (mis. data:text/html,...) bisa tersimpan
    // lalu dibuka via window.open() oleh staf Procurement di halaman Klaim Material -- risiko
    // konten disuntik yang terbuka sebagai halaman hidup, bukan sekadar foto.
    if (!photo.dataUrl.startsWith("data:image/")) {
      throw new Error("Foto bukti tidak valid -- harus berupa gambar.");
    }
    const base64Part = photo.dataUrl.slice(photo.dataUrl.indexOf(",") + 1);
    const approxBytes = Math.floor((base64Part.length * 3) / 4);
    if (approxBytes > 700 * 1024) {
      throw new Error("Foto bukti terlalu besar -- ambil ulang dengan resolusi lebih kecil.");
    }
    // Item 3.3: urutan WAJIB -- upsert material_claim_photos DULU, baru tandai claim_photo_at di
    // raw_material_invoice_rolls (lewat `update` yang ditulis setelah ini). Gagal di sini HARUS
    // menggagalkan seluruh aksi (beda dari insert material_claim_history di bawah yang opsional)
    // supaya vendor tahu foto buktinya tidak tersimpan, bukan diam-diam hilang.
    const { error: photoErr } = await db.from("material_claim_photos").upsert({
      claim_key: claimKey,
      invoice_id: invoiceId,
      warna,
      lengan,
      roll_index: rollIndex,
      data_url: photo.dataUrl,
      file_name: photo.fileName ?? null,
      uploaded_at: nowIso(),
    });
    if (photoErr) throw new Error(`Gagal menyimpan foto bukti: ${photoErr.message}`);
    update.claim_photo_at = nowIso();
  }
  const { error } = await db.from("raw_material_invoice_rolls").update(update).eq("invoice_color_id", colorId).eq("roll_index", rollIndex);
  if (error) throw new Error(error.message);

  if (claim) {
    const { data: inv } = await db.from("raw_material_invoices").select("po_id,mrp_id,supplier,destination_vendor").eq("id", invoiceId).single();
    await insertNotification(
      notif(
        `Claim selisih berat — ${inv?.po_id ?? ""} ${warna} · ${lengan} roll ${rollIndex + 1}: selisih ${claim.diffKg >= 0 ? "+" : ""}${claim.diffKg.toFixed(2)} kg (${claim.pct.toFixed(1)}%) di luar toleransi. Kode roll: ${codeRoll?.trim() || rollRow?.code_roll || "-"}, lot: ${rollRow?.code_lot || "-"}.`,
        ["procurement"]
      )
    );
    // Catat ke arsip klaim (lihat findOpenClaimHistoryId) -- gagal di sini TIDAK menggagalkan
    // aksi utama (claim di raw_material_invoice_rolls sudah tersimpan di atas).
    try {
      const historyId = await nextReadableId("MCH");
      await db.from("material_claim_history").insert({
        id: historyId,
        invoice_id: invoiceId,
        po_id: inv?.po_id ?? null,
        mrp_id: inv?.mrp_id ?? null,
        supplier: inv?.supplier ?? null,
        vendor_produksi: inv?.destination_vendor ?? null,
        warna,
        lengan,
        roll_index: rollIndex,
        code_roll: codeRoll?.trim() || rollRow?.code_roll || null,
        code_lot: rollRow?.code_lot ?? null,
        gross_kg: rollRow?.gross_kg ?? null,
        claimed_net_kg: netKg,
        diff_kg: claim.diffKg,
        pct: claim.pct,
        claim_photo_at: photo ? update.claim_photo_at : null,
      });
    } catch {
      // tabel arsip belum ada (migration 0011 belum di-apply) -- diamkan, bukan fitur inti.
    }
  } else {
    // Roll ditimbang & hasilnya sesuai toleransi -- kalau ada baris arsip TERBUKA untuk roll ini,
    // tutup di sini (auto-resolve lewat timbang ulang, beda dari resolveMaterialClaimAction yang
    // manual "Selesai" tanpa retur).
    try {
      const openId = await findOpenClaimHistoryId(db, invoiceId, warna, lengan, rollIndex);
      if (openId) {
        await db
          .from("material_claim_history")
          .update({ resolved_at: today(), resolution_kind: "AUTO_REWEIGH", resolved_net_kg: netKg, resolved_code_roll: codeRoll?.trim() || rollRow?.code_roll || null })
          .eq("id", openId);
      }
    } catch {
      // idem -- arsip opsional.
    }
  }
  void vendorId;
}

/** Item 13.2: tutup tahap "timbang" -- roll yang sudah ditimbang (net_kg terisi) & TIDAK claimable
 *  (item 4, lebih ringan dari toleransi) baru bisa masuk pool Resting setelah dikonfirmasi di sini
 *  (lihat gate weigh_confirmed_at di availableCodeRollsForColor/receivedRollCountWithCodeForColor,
 *  derive.ts). Dipanggil per GRUP (satu klik "Konfirmasi (n)" untuk semua roll warna·lengan yang
 *  sama, item 14.1) -- roll yang gagal syarat (belum ditimbang, atau masih claimable) di-skip &
 *  dilaporkan balik supaya UI bisa bilang apa yang ke-skip, bukan diam-diam gagal semua. */
export async function confirmRollWeighAction(
  items: { invoiceId: string; warna: string; lengan: Lengan; rollIndex: number }[]
): Promise<{ confirmed: number; skipped: { invoiceId: string; warna: string; lengan: Lengan; rollIndex: number }[] }> {
  const vendorId = await requireVendorSession();
  const db = supabaseServer();
  const skipped: { invoiceId: string; warna: string; lengan: Lengan; rollIndex: number }[] = [];
  let confirmed = 0;
  // Kepemilikan: pastikan tiap invoiceId yang diminta memang milik vendor sesi ini -- tanpa ini,
  // vendor A yang tahu/tebak ID invoice vendor B bisa ikut men-"Konfirmasi" roll timbang B (bukan
  // datanya sendiri). Di-cache per invoiceId supaya tidak query berulang kalau items berisi
  // banyak roll dari invoice yang sama (kasus umum: konfirmasi 1 grup warna sekaligus).
  const ownedInvoiceIds = new Map<string, boolean>();
  for (const item of items) {
    if (!ownedInvoiceIds.has(item.invoiceId)) {
      const { data: invRow } = await db.from("raw_material_invoices").select("destination_vendor").eq("id", item.invoiceId).maybeSingle();
      ownedInvoiceIds.set(item.invoiceId, invRow?.destination_vendor === vendorId);
    }
    if (!ownedInvoiceIds.get(item.invoiceId)) {
      skipped.push(item);
      continue;
    }
    const colorId = `${item.invoiceId}-${item.warna}-${item.lengan}`;
    const { data: rollRow } = await db
      .from("raw_material_invoice_rolls")
      .select("gross_kg,net_kg")
      .eq("invoice_color_id", colorId)
      .eq("roll_index", item.rollIndex)
      .maybeSingle();
    if (!rollRow || rollRow.net_kg == null) {
      skipped.push(item);
      continue;
    }
    const variance = weightVariance(Number(rollRow.gross_kg ?? 0), Number(rollRow.net_kg));
    if (variance.claimable) {
      skipped.push(item);
      continue;
    }
    const { error } = await db
      .from("raw_material_invoice_rolls")
      .update({ weigh_confirmed_at: nowIso() })
      .eq("invoice_color_id", colorId)
      .eq("roll_index", item.rollIndex);
    if (error) {
      skipped.push(item);
      continue;
    }
    confirmed++;
  }
  return { confirmed, skipped };
}

/** Item 2.4: ambil BYTE foto bukti berat bersih 1 klaim on-demand -- `material_claim_photos`
 *  sengaja DIKELUARKAN dari get_flow_snapshot_raw() (migration 0014) supaya payloadnya tidak ikut
 *  re-download di setiap refresh snapshot. Dipanggil LANGSUNG dari halaman Klaim Material
 *  (bukan lewat store/snapshot) cuma saat user klik "Lihat / Download". */
export async function getMaterialClaimPhotoAction(claimKey: string): Promise<{ dataUrl: string; fileName?: string } | null> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const { data } = await db.from("material_claim_photos").select("data_url,file_name").eq("claim_key", claimKey).maybeSingle();
  if (!data) return null;
  return { dataUrl: data.data_url, fileName: data.file_name ?? undefined };
}

export async function setMaterialPoEntityAction(poId: string, entitas: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const { error } = await db.from("material_pos").update({ entity: entitas }).eq("id", poId);
  if (error) throw new Error(error.message);
  await db.from("material_po_color_breakdown").update({ entitas }).eq("material_po_id", poId);
}

export async function setMaterialPoColorEntityAction(poId: string, warna: string, lengan: Lengan, entitas: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const { error } = await supabaseServer().from("material_po_color_breakdown").update({ entitas }).eq("material_po_id", poId).eq("warna", warna).eq("lengan", lengan);
  if (error) throw new Error(error.message);
}

export async function approveAllMaterialPosAction(): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const toApprove = await fetchUnapprovedMaterialPos(db, undefined);
  const mrpIds = Array.from(new Set(toApprove.map((po) => po.mrpId)));
  for (const po of toApprove) {
    const distinctEntitas = new Set(po.colorBreakdown.map((c) => c.entitas ?? po.entity));
    const newIds = await Promise.all(Array.from({ length: Math.max(0, distinctEntitas.size - 1) }).map(() => nextReadableId("PO-SUP")));
    const parts = splitMaterialPoByEntitas(po, newIds).map((p) => ({ ...p, approved: true }));
    await writeMaterialPoSplit(db, po.id, parts);
  }
  for (const mrpId of mrpIds) await checkPoApproved(mrpId);
}

export async function approveVendorMaterialPosAction(mrpId: string, vendor: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const toApprove = await fetchUnapprovedMaterialPos(db, { mrpId, vendorProduksi: vendor });
  for (const po of toApprove) {
    const distinctEntitas = new Set(po.colorBreakdown.map((c) => c.entitas ?? po.entity));
    const newIds = await Promise.all(Array.from({ length: Math.max(0, distinctEntitas.size - 1) }).map(() => nextReadableId("PO-SUP")));
    const parts = splitMaterialPoByEntitas(po, newIds).map((p) => ({ ...p, approved: true }));
    await writeMaterialPoSplit(db, po.id, parts);
  }
  await checkPoApproved(mrpId);
}

/** PERFORMA: mengembalikan cuttingAt/sizeQty yang baru ditulis supaya store.ts bisa nge-patch
 *  baris ProductionBatch ini LANGSUNG di client (optimistic), tanpa nunggu backgroundRefresh
 *  (snapshot 32-tabel) buat lihat roll-nya sudah "Cutting" -- ini yang secara konkret diminta user
 *  (kasus "10 roll, 5-10 detik per roll" harus kerasa ~instan per klik). Query di fungsi ini
 *  sendiri sudah selalu murah (2 tulis kecil, tidak pernah pakai getFlowSnapshot()) -- baru berasa
 *  lambat kalau UI-nya nunggu refresh penuh sesudahnya, itu yang dipotong di sini. */
export async function updateBatchToCuttingAction(batchId: string, cuttingAt: string, sizeQty: Record<string, number> = {}): Promise<{ cuttingAt: string; sizeQty?: Record<string, number> }> {
  await requireVendorSession();
  const db = supabaseServer();

  // Item 18.3: batch ini boleh diedit/"diperbaiki" berulang kali (Input Hasil Cutting SEKARANG
  // bukan sekali-jalan) SELAMA grup warna/lengannya belum benar-benar final (production_group_meta
  // .done_at, TAHAP 2). Kalau grupnya sudah fg_confirmed_at (TAHAP 1) tapi belum done_at, edit ini
  // tetap boleh jalan TAPI reject otomatis grup itu harus dihitung ULANG (recomputeAutoRejectForGroup)
  // supaya angka reject di tab Reject/Final Produksi tidak basi.
  const { data: batchRow } = await db.from("production_batches").select("mrp_id,vendor_produksi,warna,lengan").eq("id", batchId).single();
  let groupKey: string | null = null;
  if (batchRow) {
    groupKey = `${batchRow.mrp_id}|${batchRow.warna}|${batchRow.lengan}`;
    const { data: meta } = await db.from("production_group_meta").select("fg_confirmed_at,done_at").eq("group_key", groupKey).maybeSingle();
    if (meta?.done_at) {
      throw new Error(`Grup ${batchRow.warna} · ${batchRow.lengan} sudah "Selesai Produksi" (Final Produksi) -- hasil cutting tidak bisa diedit lagi.`);
    }
  }

  const { error } = await db.from("production_batches").update({ cutting_at: cuttingAt }).eq("id", batchId);
  if (error) throw new Error(error.message);
  // Hasil aduan AKTUAL roll ini (lihat komentar ProductionBatch.sizeQty di types.ts) — tabel
  // production_batch_sizes belum tentu ada (butuh migration 0006_production_batch_output.sql).
  // Errornya SENGAJA tidak dilempar (cuma dicatat) supaya "Input Hasil Cutting" di atas (aksi
  // utamanya, sudah berhasil) tidak ikut gagal hanya karena fitur tambahan ini belum ter-migrate
  // di environment tertentu.
  // Item 18.3: HAPUS dulu baris lama batch ini sebelum insert -- dulu insert-only, jadi panggilan
  // KEDUA ("Perbaiki Hasil Cutting") menumpuk baris duplikat alih-alih menggantikannya.
  const { error: delErr } = await db.from("production_batch_sizes").delete().eq("production_batch_id", batchId);
  if (delErr) console.error("updateBatchToCuttingAction: gagal hapus hasil aduan lama", delErr.message);
  const rows = Object.entries(sizeQty).filter(([, qty]) => qty > 0);
  if (rows.length > 0) {
    const { error: sizeErr } = await db.from("production_batch_sizes").insert(rows.map(([size, qty]) => ({ production_batch_id: batchId, size, qty })));
    if (sizeErr) console.error("updateBatchToCuttingAction: gagal simpan hasil aduan (migration 0006 sudah jalan?)", sizeErr.message);
  }

  if (batchRow && groupKey) {
    const { data: metaAfter } = await db.from("production_group_meta").select("fg_confirmed_at,done_at").eq("group_key", groupKey).maybeSingle();
    if (metaAfter?.fg_confirmed_at && !metaAfter.done_at) {
      await recomputeAutoRejectForGroup(db, groupKey, batchRow.mrp_id, batchRow.vendor_produksi, batchRow.warna, batchRow.lengan as Lengan);
    }
  }

  return { cuttingAt, sizeQty: rows.length > 0 ? Object.fromEntries(rows) : undefined };
}

/** Tandai alert yield <99% roll ini sudah ditindaklanjuti/di-approve dari portal internal
 *  Produksi (audience "produksi" — BUKAN Procurement, beda dari material claim berat). */
export async function resolveProductionYieldAction(batchId: string, note: string): Promise<void> {
  await requireInternalRole(await requireSession(), "produksi");
  const { error } = await supabaseServer().from("production_yield_resolutions").upsert({ production_batch_id: batchId, note, resolved_at: today() });
  if (error) throw new Error(error.message);
}

export async function unresolveProductionYieldAction(batchId: string): Promise<void> {
  await requireInternalRole(await requireSession(), "produksi");
  await supabaseServer().from("production_yield_resolutions").delete().eq("production_batch_id", batchId);
}

export async function updateDeliveryKoliAction(koliId: string, patch: { ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const { data: koli } = await db.from("delivery_kolis").select("delivered_at").eq("id", koliId).maybeSingle();
  if (!koli || koli.delivered_at) return;
  await db.from("delivery_kolis").update({ ekspedisi: patch.ekspedisi, no_koli: patch.noKoli }).eq("id", koliId);
  await db.from("delivery_koli_items").delete().eq("delivery_koli_id", koliId);
  if (patch.items.length > 0) {
    await db.from("delivery_koli_items").insert(patch.items.map((it) => ({ delivery_koli_id: koliId, warna: it.warna, lengan: it.lengan, size: it.size, qty: it.qty, kind: it.kind, usia: it.usia ?? null })));
  }
}

export async function setVendorInvoiceDueDateAction(invoiceId: string, dueDate: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const { error } = await supabaseServer().from("vendor_invoices").update({ due_date: dueDate }).eq("id", invoiceId);
  if (error) throw new Error(error.message);
}

export async function setVendorInvoiceOngkirAction(invoiceId: string, ongkirTotal: number): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const { error } = await supabaseServer().from("vendor_invoices").update({ ongkir_total: Math.max(0, ongkirTotal) }).eq("id", invoiceId);
  if (error) throw new Error(error.message);
}

export async function setRejectRemarkAction(poId: string, remark: string): Promise<void> {
  await requireVendorSession();
  const { error } = await supabaseServer().from("maklon_pos").update({ reject_remark: remark }).eq("id", poId);
  if (error) throw new Error(error.message);
}

/** Key format: "invoiceId|warna|lengan|rollIndex" (lihat materialClaimsList di derive.ts) --
 *  di-parse balik ke lokasi baris raw_material_invoice_rolls yang bersangkutan. */
function parseClaimKey(key: string): { invoiceId: string; warna: string; lengan: Lengan; invoiceColorId: string; rollIndex: number } | null {
  const parts = key.split("|");
  if (parts.length !== 4) return null;
  const [invoiceId, warna, lengan, rollIndexStr] = parts;
  return { invoiceId, warna, lengan: lengan as Lengan, invoiceColorId: `${invoiceId}-${warna}-${lengan}`, rollIndex: parseInt(rollIndexStr, 10) };
}

/** Cari baris material_claim_history yang masih TERBUKA (resolved_at kosong) untuk 1 roll --
 *  dipakai buat update progres (retur diminta/dikirim/diterima/selesai) ke baris arsip yang
 *  sama persis dengan progres yang ditulis ke kolom claim_retur_.../claim_resolved_... di
 *  raw_material_invoice_rolls (lihat migration 0011_material_claim_history.sql). Kalau
 *  tabelnya belum ada (migration belum di-apply) atau baris terbuka tidak ketemu, return null
 *  diam-diam -- arsip ini fitur TAMBAHAN, gagal update di sini TIDAK BOLEH menggagalkan aksi
 *  utamanya (mis. Minta Retur tetap harus jalan meski baris arsipnya entah kenapa tidak ada). */
async function findOpenClaimHistoryId(db: ReturnType<typeof supabaseServer>, invoiceId: string, warna: string, lengan: Lengan, rollIndex: number): Promise<string | null> {
  try {
    const { data } = await db
      .from("material_claim_history")
      .select("id")
      .eq("invoice_id", invoiceId)
      .eq("warna", warna)
      .eq("lengan", lengan)
      .eq("roll_index", rollIndex)
      .is("resolved_at", null)
      .order("claimed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function resolveMaterialClaimAction(key: string, note: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  const { error } = await db
    .from("raw_material_invoice_rolls")
    .update({ claim_resolved_note: note, claim_resolved_at: today() })
    .eq("invoice_color_id", parsed.invoiceColorId)
    .eq("roll_index", parsed.rollIndex);
  if (error) throw new Error(error.message);
  try {
    const openId = await findOpenClaimHistoryId(db, parsed.invoiceId, parsed.warna, parsed.lengan, parsed.rollIndex);
    if (openId) await db.from("material_claim_history").update({ resolved_at: today(), resolved_note: note, resolution_kind: "MANUAL" }).eq("id", openId);
  } catch {
    // arsip opsional.
  }
}

export async function unresolveMaterialClaimAction(key: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  await db.from("raw_material_invoice_rolls").update({ claim_resolved_note: null, claim_resolved_at: null }).eq("invoice_color_id", parsed.invoiceColorId).eq("roll_index", parsed.rollIndex);
  try {
    // "Buka lagi" cuma bisa dipanggil untuk klaim yang statusnya masih SELESAI -- baris arsip
    // yang relevan justru yang SUDAH resolved (bukan openId), jadi dicari langsung tanpa
    // findOpenClaimHistoryId (yang khusus baris resolved_at kosong).
    const { data } = await db
      .from("material_claim_history")
      .select("id")
      .eq("invoice_id", parsed.invoiceId)
      .eq("warna", parsed.warna)
      .eq("lengan", parsed.lengan)
      .eq("roll_index", parsed.rollIndex)
      .eq("resolution_kind", "MANUAL")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) await db.from("material_claim_history").update({ resolved_at: null, resolved_note: null, resolution_kind: null }).eq("id", data.id);
  } catch {
    // arsip opsional.
  }
}

/** Fetch SATU RawMaterialInvoice by id -- CUMA field yang dibaca materialClaimsList (colorEntries
 *  + rollReceipts, plus id/poId/mrpId/supplier/destinationVendor buat isi MaterialClaimRow) --
 *  bukan getFlowSnapshot() penuh (32 tabel). Field lain (addBuys/status pembayaran/dst) sengaja
 *  di-stub kosong -- 3 pemanggilnya (request/markDelivered/confirmReceived retur klaim) semua
 *  cuma butuh materialClaimsList([inv]).find((c) => c.key === key), tidak baca field lain. */
async function fetchOneInvoiceForClaims(db: SupabaseClient, invoiceId: string): Promise<RawMaterialInvoice | undefined> {
  const [invRes, colorRes] = await Promise.all([
    db.from("raw_material_invoices").select("*").eq("id", invoiceId).maybeSingle(),
    db.from("raw_material_invoice_colors").select("*, raw_material_invoice_rolls(*)").eq("invoice_id", invoiceId),
  ]);
  const inv = invRes.data;
  if (!inv) return undefined;
  const colorEntries: ColorEntry[] = [];
  const rollReceipts: Record<string, (RollReceipt | null)[]> = {};
  for (const c of colorRes.data ?? []) {
    const colorKey = `${c.warna}|${c.lengan}`;
    const rolls = (c.raw_material_invoice_rolls ?? []).sort((a: { roll_index: number }, b: { roll_index: number }) => a.roll_index - b.roll_index);
    colorEntries.push({ warna: c.warna, lengan: c.lengan, hargaPerRoll: Number(c.harga_per_roll), rolls: rolls.map((r: { gross_kg: number }) => Number(r.gross_kg)) });
    rollReceipts[colorKey] = rolls.map((r: { net_kg: number | null; received_at: string | null; code_roll: string | null; code_lot: string | null }) =>
      r.net_kg == null ? null : { netKg: Number(r.net_kg), receivedAt: r.received_at ?? "", codeRoll: r.code_roll ?? undefined, codeLot: r.code_lot ?? undefined }
    );
  }
  return {
    id: inv.id,
    poId: inv.po_id,
    mrpId: inv.mrp_id,
    vendorProduksi: inv.vendor_produksi,
    supplier: inv.supplier,
    colorEntries,
    addBuys: [],
    qtyReady: 0,
    diskon: 0,
    totalBiaya: 0,
    kodeTransaksi: "",
    noInvoiceVendor: "",
    entity: "",
    status: inv.status,
    destinationVendor: inv.destination_vendor ?? "",
    bookedAt: inv.booked_at,
    rollReceipts,
    rollArrivals: {},
    addBuyReceipts: {},
  };
}

export async function requestMaterialClaimReturAction(key: string, note: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  await db.from("raw_material_invoice_rolls").update({ claim_retur_note: note, claim_retur_requested_at: today() }).eq("invoice_color_id", parsed.invoiceColorId).eq("roll_index", parsed.rollIndex);
  try {
    const openId = await findOpenClaimHistoryId(db, parsed.invoiceId, parsed.warna, parsed.lengan, parsed.rollIndex);
    if (openId) await db.from("material_claim_history").update({ retur_note: note, retur_requested_at: today() }).eq("id", openId);
  } catch {
    // arsip opsional.
  }
  const inv = await fetchOneInvoiceForClaims(db, parsed.invoiceId);
  const claim = inv && materialClaimsList([inv]).find((c) => c.key === key);
  if (claim) {
    await insertNotification(
      notif(
        `Retur diminta ke supplier ${claim.supplier} untuk roll #${claim.rollIndex + 1} (${claim.warna} · ${claim.lengan}, invoice ${claim.invoiceId}). Timbang ulang roll ini begitu penggantinya sampai — catatan: ${note}`,
        ["vendorMaklon"],
        claim.vendorProduksi
      )
    );
  }
}

export async function cancelMaterialClaimReturRequestAction(key: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  // Batalkan mereset SELURUH progres retur (diminta -> dikirim -> diterima), bukan cuma
  // permintaan awal -- kalau tidak, sisa kolom delivered/received bisa nyangkut dan bikin
  // stageOf() di halaman Klaim Material salah baca status setelah dibatalkan.
  await db
    .from("raw_material_invoice_rolls")
    .update({ claim_retur_note: null, claim_retur_requested_at: null, claim_retur_delivered_note: null, claim_retur_delivered_at: null, claim_retur_received_at: null })
    .eq("invoice_color_id", parsed.invoiceColorId)
    .eq("roll_index", parsed.rollIndex);
  try {
    const openId = await findOpenClaimHistoryId(db, parsed.invoiceId, parsed.warna, parsed.lengan, parsed.rollIndex);
    if (openId) await db.from("material_claim_history").update({ retur_note: null, retur_requested_at: null, retur_delivered_note: null, retur_delivered_at: null, retur_received_at: null }).eq("id", openId);
  } catch {
    // arsip opsional.
  }
}

/** Procurement menandai roll pengganti (hasil "Minta Retur") sudah dikirim ke vendor -- biasanya
 *  dipicu setelah supplier mengabari lewat WA. Tahap antara "Retur diminta" dan vendor benar2
 *  timbang ulang di Cutting, supaya progresnya kelihatan di ERP bukan cuma di chat WA. */
export async function markMaterialClaimReturDeliveredAction(key: string, note?: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  await db
    .from("raw_material_invoice_rolls")
    .update({ claim_retur_delivered_note: note ?? null, claim_retur_delivered_at: today() })
    .eq("invoice_color_id", parsed.invoiceColorId)
    .eq("roll_index", parsed.rollIndex);
  try {
    const openId = await findOpenClaimHistoryId(db, parsed.invoiceId, parsed.warna, parsed.lengan, parsed.rollIndex);
    if (openId) await db.from("material_claim_history").update({ retur_delivered_note: note ?? null, retur_delivered_at: today() }).eq("id", openId);
  } catch {
    // arsip opsional.
  }
  const invForNotif = await fetchOneInvoiceForClaims(db, parsed.invoiceId);
  const claim = invForNotif && materialClaimsList([invForNotif]).find((c) => c.key === key);
  if (claim) {
    await insertNotification(
      notif(
        `Roll pengganti untuk klaim retur roll #${claim.rollIndex + 1} (${claim.warna} · ${claim.lengan}, invoice ${claim.invoiceId}) sudah dikirim Procurement. Konfirmasi setelah diterima di halaman Produksi (tab Cutting).${note ? " Catatan: " + note : ""}`,
        ["vendorMaklon"],
        claim.vendorProduksi
      )
    );
  }
}

/** Vendor mengonfirmasi roll pengganti (hasil "Minta Retur") sudah diterima secara fisik --
 *  dicatat terpisah dari timbang ulang (net_kg) karena konfirmasi terima bisa duluan sebelum
 *  sempat ditimbang. Tombolnya ada di halaman Produksi > Cutting, section "Timbang roll". */
export async function confirmMaterialClaimReturReceivedAction(key: string): Promise<void> {
  const vendorId = await requireVendorSession();
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  await db.from("raw_material_invoice_rolls").update({ claim_retur_received_at: today() }).eq("invoice_color_id", parsed.invoiceColorId).eq("roll_index", parsed.rollIndex);
  try {
    const openId = await findOpenClaimHistoryId(db, parsed.invoiceId, parsed.warna, parsed.lengan, parsed.rollIndex);
    if (openId) await db.from("material_claim_history").update({ retur_received_at: today() }).eq("id", openId);
  } catch {
    // arsip opsional.
  }
  const invForNotif = await fetchOneInvoiceForClaims(db, parsed.invoiceId);
  const claim = invForNotif && materialClaimsList([invForNotif]).find((c) => c.key === key);
  if (claim) {
    await insertNotification(
      notif(
        `Vendor konfirmasi roll pengganti untuk klaim retur roll #${claim.rollIndex + 1} (${claim.warna} · ${claim.lengan}, invoice ${claim.invoiceId}) sudah diterima -- tinggal ditimbang ulang.`,
        ["procurement"]
      )
    );
  }
  void vendorId;
}

/** Fetch aduan_pola_rows (+sizes) untuk SATU mrpId -- targeted, dipakai
 *  fetchProductionScopeForMrp maupun closePoWithReasonAction/reassignMaterialToSupplierAction di
 *  bawah (dua-duanya cuma butuh potongan .aduanRows ini, bukan MrpDetail penuh). */
async function fetchAduanRowsForMrp(db: SupabaseClient, mrpId: string): Promise<AduanPolaRow[]> {
  const { data } = await db.from("aduan_pola_rows").select("*, aduan_pola_sizes(size,qty)").eq("mrp_id", mrpId);
  return (data ?? []).map((a) => ({
    id: a.id,
    lenganGroupId: a.lengan_group_id,
    warna: a.warna,
    lengan: a.lengan,
    kode: a.kode,
    qtyRoll: Number(a.qty_roll),
    sizes: (a.aduan_pola_sizes ?? []).map((s: { size: string; qty: number }) => ({ size: s.size, qty: s.qty })),
    qty: a.qty,
    vendor: a.vendor,
    ribAllocatedRoll: a.rib_allocated_roll == null ? undefined : Number(a.rib_allocated_roll),
  }));
}

/** Fetch tabel rate harga kain (harga_kain + harga_kain_pks) -- dipakai materialAmountForPo.
 *  Tabel LOOKUP GLOBAL kecil (harga per supplier/kategori/warna, bukan per-MRP), jadi tetap
 *  di-fetch penuh (bukan getFlowSnapshot() 32-tabel, tapi 2 tabel kecil ini saja). */
async function fetchHargaTables(db: SupabaseClient): Promise<{ hargaKain: HargaKainRow[]; hargaKainPks: HargaKainPksRow[] }> {
  const [kainRes, pksRes] = await Promise.all([db.from("harga_kain").select("*"), db.from("harga_kain_pks").select("*")]);
  const hargaKain: HargaKainRow[] = (kainRes.data ?? []).map((r) => ({
    id: r.id,
    kodeSupplier: r.kode_supplier,
    namaSupplier: r.nama_supplier,
    kategori: r.kategori,
    warna: r.warna,
    hargaPerKg: Number(r.harga_per_kg),
  }));
  const hargaKainPks: HargaKainPksRow[] = (pksRes.data ?? []).map((r) => ({
    id: r.id,
    kodeSupplier: r.kode_supplier,
    kategori: r.kategori,
    warna: r.warna,
    satuan: r.satuan,
    tonaseMin: r.tonase_min == null ? undefined : Number(r.tonase_min),
    tonaseMax: r.tonase_max == null ? undefined : Number(r.tonase_max),
    hargaPerKg: Number(r.harga_per_kg),
  }));
  return { hargaKain, hargaKainPks };
}

export async function closePoWithReasonAction(poId: string, reason: string, warna: string, lengan: Lengan, closeQty: number): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const po = await fetchOneMaterialPo(db, poId);
  if (!po) return;
  const colorKey = `${warna}|${lengan}`;
  const colorEntry = po.colorBreakdown.find((c) => c.warna === warna && c.lengan === lengan);
  if (!colorEntry) return;
  const invoicedForColor = po.invoicedByColor[colorKey] ?? 0;
  const colorRemaining = colorEntry.rollCount - invoicedForColor;
  const qty = Math.max(1, Math.min(closeQty, colorRemaining));

  const newColorBreakdown = po.colorBreakdown.map((c) => (c.warna === warna && c.lengan === lengan ? { ...c, rollCount: c.rollCount - qty } : c));
  const newRollCount = po.rollCount - qty;
  const fullyClosed = newRollCount <= po.invoicedRolls;

  const [aduanRows, { hargaKain, hargaKainPks }, maklonRes] = await Promise.all([
    fetchAduanRowsForMrp(db, po.mrpId),
    fetchHargaTables(db),
    db.from("maklon_pos").select("id,qty,amount,status").eq("mrp_id", po.mrpId).eq("vendor_produksi", po.vendorProduksi).maybeSingle(),
  ]);
  let pcsRemoved = 0;
  const colorAduanRows = aduanRows.filter((a) => a.vendor === po.vendorProduksi && a.warna === warna && a.lengan === lengan);
  const colorTotalRolls = colorAduanRows.reduce((s, a) => s + a.qtyRoll, 0);
  const colorTotalQty = colorAduanRows.reduce((s, a) => s + a.qty, 0);
  if (colorTotalRolls > 0) pcsRemoved = Math.round(colorTotalQty * (qty / colorTotalRolls));

  await db.from("material_po_color_breakdown").update({ roll_count: newColorBreakdown.find((c) => c.warna === warna && c.lengan === lengan)!.rollCount }).eq("material_po_id", poId).eq("warna", warna).eq("lengan", lengan);
  await db
    .from("material_pos")
    .update({ roll_count: newRollCount, amount: materialAmountForPo(hargaKain, hargaKainPks, po.supplier, newColorBreakdown), status: fullyClosed ? "CANCELLED" : po.status })
    .eq("id", poId);

  const maklon = maklonRes.data;
  if (maklon) {
    const newQty = Math.max(0, maklon.qty - pcsRemoved);
    await db
      .from("maklon_pos")
      .update({
        qty: newQty,
        amount: maklon.qty > 0 ? Math.round((maklon.amount / maklon.qty) * newQty) : 0,
        status: pcsRemoved > 0 && maklon.status === "FULL_WAITING_MATERIAL" ? "PARTIAL_WAITING_MATERIAL" : maklon.status,
      })
      .eq("id", maklon.id);
    await db.from("maklon_po_cancelled_lines").insert({ maklon_po_id: maklon.id, note: reason, rolls: qty, warna, lengan, pcs: pcsRemoved, from_vendor: "Procurement", time: nowClock() });
  }

  await insertNotification(
    notif(
      `PO ${poId} (${warna} · ${lengan}) ditutup ${fullyClosed ? "penuh" : "sebagian"} (${qty} roll) — alasan: ${reason}. PO Vendor Produksi ikut terpotong ${pcsRemoved} pcs.`,
      ["finance", "vendorMaklon"],
      po.vendorProduksi
    )
  );
}

export async function reassignMaterialToSupplierAction(poId: string, warna: string, lengan: Lengan, moveQty: number, newSupplier: string, reason: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const po = await fetchOneMaterialPo(db, poId);
  if (!po) return;
  const colorKey = `${warna}|${lengan}`;
  const colorEntry = po.colorBreakdown.find((c) => c.warna === warna && c.lengan === lengan);
  if (!colorEntry) return;
  const invoicedForColor = po.invoicedByColor[colorKey] ?? 0;
  const colorRemaining = colorEntry.rollCount - invoicedForColor;
  const qty = Math.max(1, Math.min(moveQty, colorRemaining));

  const newColorBreakdown = po.colorBreakdown.map((c) => (c.warna === warna && c.lengan === lengan ? { ...c, rollCount: c.rollCount - qty } : c));
  const newRollCount = po.rollCount - qty;
  const fullyClosed = newRollCount <= po.invoicedRolls;

  const { hargaKain, hargaKainPks } = await fetchHargaTables(db);
  const newPoColorBreakdown = [{ warna, lengan, rollCount: qty, entitas: colorEntry.entitas ?? po.entity }];
  const newPoId = await nextReadableId("PO-SUP");
  const newPoAmount = materialAmountForPo(hargaKain, hargaKainPks, newSupplier, newPoColorBreakdown);

  await db.from("material_po_color_breakdown").update({ roll_count: newColorBreakdown.find((c) => c.warna === warna && c.lengan === lengan)!.rollCount }).eq("material_po_id", poId).eq("warna", warna).eq("lengan", lengan);
  await db
    .from("material_pos")
    .update({ roll_count: newRollCount, amount: materialAmountForPo(hargaKain, hargaKainPks, po.supplier, newColorBreakdown), status: fullyClosed ? "CANCELLED" : po.status })
    .eq("id", poId);

  await db.from("material_pos").insert({
    id: newPoId,
    mrp_id: po.mrpId,
    vendor_produksi: po.vendorProduksi,
    supplier: newSupplier,
    warna,
    lengan,
    roll_count: qty,
    available_rolls: qty,
    invoiced_rolls: 0,
    amount: newPoAmount,
    entity: colorEntry.entitas ?? po.entity,
    status: "WAITING_INVOICE",
    approved: false,
    days_since_po: 0,
  });
  await db.from("material_po_color_breakdown").insert({ material_po_id: newPoId, warna, lengan, roll_count: qty, entitas: colorEntry.entitas ?? po.entity });

  await insertNotification(
    notif(`PO ${poId} (${warna} · ${lengan}, ${qty} roll) dialihkan dari supplier ${po.supplier} ke ${newSupplier} — alasan: ${reason}. PO material baru ${newPoId} menunggu approval Finance.`, ["finance"])
  );
}

export async function receiveRawMaterialAddBuyAction(invoiceId: string, addBuyId: string): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  await db.from("raw_material_invoice_addbuys").update({ received_at: today() }).eq("id", addBuyId).eq("invoice_id", invoiceId);
  const { data: inv } = await db.from("raw_material_invoices").select("status,received_at").eq("id", invoiceId).single();
  if (inv) {
    await db.from("raw_material_invoices").update({ status: inv.status === "DELIVERY" ? "RECEIVING" : inv.status, received_at: inv.received_at ?? today() }).eq("id", invoiceId);
  }
}

export async function advanceMaklonProductionAction(id: string): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const { data: po } = await db.from("maklon_pos").select("status").eq("id", id).single();
  if (!po) return;
  let next: string | null = null;
  if (po.status === "FULL_WAITING_MATERIAL" || po.status === "PARTIAL_WAITING_MATERIAL") next = "PRODUCTION";
  else if (po.status === "PRODUCTION") next = "DELIVERY";
  if (next) await db.from("maklon_pos").update({ status: next }).eq("id", id);
}

export async function approveMaklonInvoiceAction(invoiceId: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const { data: inv } = await db.from("maklon_invoices").select("id,vendor_produksi").eq("id", invoiceId).single();
  await db.from("maklon_invoices").update({ status: "APPROVED", approved_at: today() }).eq("id", invoiceId);
  if (inv) await insertNotification(notif(`Invoice maklon ${inv.id} disetujui Finance — menunggu payment`, ["vendorMaklon"], inv.vendor_produksi));
}

export async function payMaklonInvoiceAction(invoiceId: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const { data: inv } = await db.from("maklon_invoices").select("id,vendor_produksi,maklon_po_id").eq("id", invoiceId).single();
  if (!inv) return;
  await db.from("maklon_invoices").update({ status: "PAID", paid_at: today() }).eq("id", invoiceId);
  await db.from("maklon_pos").update({ status: "FULLY_PAID" }).eq("id", inv.maklon_po_id);
  await insertNotification(notif(`Invoice maklon ${inv.id} telah dibayar Finance`, ["vendorMaklon"], inv.vendor_produksi));
}

export async function undoProductionGroupDoneAction(groupKey: string): Promise<void> {
  await requireVendorSession();
  const { error } = await supabaseServer().from("production_group_meta").update({ done_at: null }).eq("group_key", groupKey);
  if (error) throw new Error(error.message);
}

// =========================================================================
// Produksi
// =========================================================================

export async function startProductionBatchAction(input: { mrpId: string; aduanRowId: string; qtyRoll: number; gramasi: number; restingAt: string; codeRoll?: string }): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const { data: aduanRow } = await db.from("aduan_pola_rows").select("vendor,kode,warna,lengan").eq("id", input.aduanRowId).single();
  if (!aduanRow) throw new Error("Baris Aduan Pola tidak ditemukan.");
  const id = await nextReadableId("BATCH");
  const { error } = await db.from("production_batches").insert({
    id,
    mrp_id: input.mrpId,
    vendor_produksi: aduanRow.vendor,
    aduan_row_id: input.aduanRowId,
    kode: aduanRow.kode,
    warna: aduanRow.warna,
    lengan: aduanRow.lengan,
    qty_roll: input.qtyRoll,
    gramasi: input.gramasi,
    resting_at: input.restingAt,
    created_at: today(),
    code_roll: input.codeRoll ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function submitProductionResultAction(input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; kind: "FG" | "REJECT"; sizeQty: Record<string, number>; note?: string }): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const groupKey = `${input.mrpId}|${input.warna}|${input.lengan}`;
  const { data: meta } = await db.from("production_group_meta").select("done_at").eq("group_key", groupKey).maybeSingle();
  if (meta?.done_at) return;

  const { data: maklon } = await db.from("maklon_pos").select("id").eq("mrp_id", input.mrpId).eq("vendor_produksi", input.vendorProduksi).maybeSingle();
  const id = await nextReadableId("PR");
  const { error } = await db.from("production_results").insert({
    id,
    group_key: groupKey,
    mrp_id: input.mrpId,
    vendor_produksi: input.vendorProduksi,
    po_id: maklon?.id ?? "",
    warna: input.warna,
    lengan: input.lengan,
    kind: input.kind,
    recorded_at: nowIso(),
    note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
  const sizeRows = Object.entries(input.sizeQty).map(([size, qty]) => ({ production_result_id: id, size, qty }));
  if (sizeRows.length > 0) await db.from("production_result_sizes").insert(sizeRows);

  await maybeAdvanceMaklonToDelivery(input.mrpId, input.vendorProduksi);
}

/** Data pendukung TARGETED (bukan getFlowSnapshot() penuh) untuk 1 mrpId+vendorProduksi -- persis
 *  yang dibutuhkan cuttingSizesForGroup/targetSizesForGroup/cumulativeSizeQtyForGroup
 *  (lib/mrp/derive.ts), yang terbukti CUMA PERNAH baca data untuk SATU mrp (+vendor untuk
 *  batch/hasil), tidak pernah lintas-MRP. Dipakai bareng oleh confirmFgDoneAction &
 *  maybeAdvanceMaklonToDelivery -- dua-duanya jalur Produksi paling sering diklik.
 *
 *  PERFORMA: dulu masing-masing fetch lewat getFlowSnapshot() (32 tabel, ratusan KB, ~0.6-1.4
 *  detik terukur langsung ke Supabase). Sekarang 3 query kecil paralel, di-scope ke 1 mrp+vendor.
 *
 *  Pemetaan kolom persis lib/mrp/repo/snapshot.ts (dibaca ulang saat menulis ini) supaya bentuk
 *  objeknya SAMA dengan yang dipakai getFlowSnapshot() -- fungsi murni derive.ts-nya tidak
 *  berubah sama sekali, cuma sumber datanya yang di-target-kan. `MrpDetail` yang dikembalikan
 *  CUMA benar untuk field `.aduanRows` (satu-satunya yang dibaca fungsi2 di atas lewat
 *  mrpDetailFor) -- field lain (lenganGroups/materialRows/dates/dst) sengaja kosong/dummy, JANGAN
 *  dipakai untuk keperluan lain. */
async function fetchProductionScopeForMrp(
  db: SupabaseClient,
  mrpId: string,
  vendorProduksi: string
): Promise<{ mrpDetail: MrpDetail; batches: ProductionBatch[]; results: ProductionResult[] }> {
  const [aduanRows, batchRes, resultRes] = await Promise.all([
    fetchAduanRowsForMrp(db, mrpId),
    db.from("production_batches").select("*").eq("mrp_id", mrpId).eq("vendor_produksi", vendorProduksi),
    db.from("production_results").select("*, production_result_sizes(size,qty)").eq("mrp_id", mrpId).eq("vendor_produksi", vendorProduksi).eq("kind", "FG"),
  ]);

  const mrpDetail: MrpDetail = {
    mrp: { id: mrpId, kategori: "", warna: "", targetDate: "", live: true, qty: 0 },
    lenganGroups: [],
    aduanRows,
    materialRows: [],
    poSent: false,
    dates: { created: "" },
    ppicApproval: "DRAFT",
  };

  const batches: ProductionBatch[] = (batchRes.data ?? []).map((b) => ({
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
    // sizeQty (hasil aduan aktual) sengaja tidak di-fetch -- tidak dibaca oleh
    // targetSizesForGroup/maklonProductionFullyDone.
  }));

  const results: ProductionResult[] = (resultRes.data ?? []).map((r) => {
    const sizeQty: Record<string, number> = {};
    for (const s of r.production_result_sizes ?? []) sizeQty[s.size] = s.qty;
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

  return { mrpDetail, batches, results };
}

/** Jalankan derive.advanceMaklonToDeliveryIfFullyDone (fungsi murni yang sama persis dipakai UI
 *  lama) -- kalau hasilnya bilang PO maklon harus pindah ke DELIVERY, tulis balik status itu.
 *  Dipanggil setelah tiap kali ada ProductionResult baru (submitProductionResult, rework/waste,
 *  confirmFgDone, markProductionGroupDone -- 4 action Produksi paling sering diklik). Begitu
 *  status PO BUKAN "PRODUCTION" (early-return pertama fungsi murninya), berhenti setelah 1 query
 *  kecil tanpa perlu fetchProductionScopeForMrp sama sekali. */
async function maybeAdvanceMaklonToDelivery(mrpId: string, vendorProduksi: string) {
  const db = supabaseServer();

  const { data: poRow } = await db.from("maklon_pos").select("*").eq("mrp_id", mrpId).eq("vendor_produksi", vendorProduksi).maybeSingle();
  if (!poRow || poRow.status !== "PRODUCTION") return;

  const [cancelledRes, scope] = await Promise.all([
    db.from("maklon_po_cancelled_lines").select("*").eq("maklon_po_id", poRow.id),
    fetchProductionScopeForMrp(db, mrpId, vendorProduksi),
  ]);

  const po: MaklonPO = {
    id: poRow.id,
    mrpId: poRow.mrp_id,
    vendorProduksi: poRow.vendor_produksi,
    qty: poRow.qty,
    amount: Number(poRow.amount),
    entity: poRow.entity ?? "",
    status: poRow.status,
    approved: poRow.approved,
    cancelledLines: (cancelledRes.data ?? []).map((c) => ({
      note: c.note,
      rolls: Number(c.rolls),
      warna: c.warna ?? undefined,
      lengan: c.lengan ?? undefined,
      pcs: c.pcs ?? undefined,
      from: c.from_vendor ?? undefined,
      time: c.time,
    })),
  };

  const updated = advanceMaklonToDeliveryIfFullyDone(mrpId, vendorProduksi, [po], [scope.mrpDetail], scope.batches, scope.results);
  const after = updated.find((m) => m.id === po.id);
  if (after && after.status !== po.status) {
    await db.from("maklon_pos").update({ status: after.status }).eq("id", after.id);
  }
}

export async function reworkRejectSizeAction(input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; fromSize: string; qty: number; toLengan: Lengan; toSize: string; usia: Usia }): Promise<void> {
  await requireVendorSession();
  // Rework fisik cuma bisa memotong lengan PANJANG jadi PENDEK (sisa potongan lengan), tidak bisa
  // sebaliknya (lengan PENDEK tidak bisa "dipanjangkan" lagi) — dulu tidak ada guard sama sekali,
  // baik di UI (dropdown bebas pilih) maupun di sini, jadi rework PENDEK→PANJANG bisa kesimpan.
  if (input.lengan === "PENDEK" && input.toLengan === "PANJANG") {
    throw new Error("Rework PENDEK ke PANJANG tidak valid — lengan yang sudah dipotong pendek tidak bisa dipanjangkan lagi.");
  }
  const db = supabaseServer();
  const sourceGroupKey = `${input.mrpId}|${input.warna}|${input.lengan}`;
  const outputGroupKey = `${input.mrpId}|${input.warna}|${input.toLengan}`;
  // Dulu diam-diam `return` di sini kalau grup sumber/tujuan sudah "Selesai Produksi" -- dari sisi
  // UI itu tampak seperti tombol "Simpan Rework" tidak melakukan apa-apa sama sekali (dialog
  // ditutup, tapi tidak ada yang tersimpan, tanpa pesan error apa pun). Sekarang dilempar sebagai
  // error supaya UI (production-rework-tab.tsx) bisa menampilkannya ke user.
  const { data: metas } = await db.from("production_group_meta").select("group_key,done_at").in("group_key", [sourceGroupKey, outputGroupKey]);
  if ((metas ?? []).some((g) => g.done_at)) {
    throw new Error(
      `Grup ${input.warna} · ${sourceGroupKey === outputGroupKey ? input.lengan : `${input.lengan} atau ${input.toLengan}`} sudah ditandai "Selesai Produksi" -- buka kunci dulu di tab Final Produksi sebelum bisa rework.`
    );
  }

  const { data: maklon } = await db.from("maklon_pos").select("id").eq("mrp_id", input.mrpId).eq("vendor_produksi", input.vendorProduksi).maybeSingle();
  const rejectId = await nextReadableId("PR");
  const fgId = await nextReadableId("PR");
  const recordedAt = nowIso();
  await db.from("production_results").insert([
    {
      id: rejectId,
      group_key: sourceGroupKey,
      mrp_id: input.mrpId,
      vendor_produksi: input.vendorProduksi,
      po_id: maklon?.id ?? "",
      warna: input.warna,
      lengan: input.lengan,
      kind: "REJECT",
      recorded_at: recordedAt,
      note: `Rework ${input.qty} pcs ke ${input.toLengan} size ${input.toSize} (${input.usia})`,
    },
    {
      id: fgId,
      group_key: outputGroupKey,
      mrp_id: input.mrpId,
      vendor_produksi: input.vendorProduksi,
      po_id: maklon?.id ?? "",
      warna: input.warna,
      lengan: input.toLengan,
      kind: "FG",
      recorded_at: recordedAt,
      note: `Rework dari ${input.lengan} size ${input.fromSize} (${input.usia})`,
      usia: input.usia,
    },
  ]);
  await db.from("production_result_sizes").insert([
    { production_result_id: rejectId, size: input.fromSize, qty: -input.qty },
    { production_result_id: fgId, size: input.toSize, qty: input.qty },
  ]);

  await maybeAdvanceMaklonToDelivery(input.mrpId, input.vendorProduksi);
}

// Item 19 (feedback batch 2026-09-04): "Buang ke Sisa" dihapus dari UI & flow -- wasteRejectSizeAction
// (dulu di sini) sudah tidak dipakai lagi & dihapus. wasteQtyForGroup (derive.ts) TETAP dipertahankan
// (masih dipakai sebagai guard di undoFgConfirmAction di bawah) dan baris WASTE lama (kalau ada)
// tetap valid secara historis -- tidak ada migration yang menghapus enum 'WASTE'/data lama.

/** Item 18.4: hitung ulang reject OTOMATIS (kind='REJECT' dan note null -- beda dari reject hasil
 *  rework manual) 1 grup warna/lengan dari SELISIH hasil cutting AKTUAL (cuttingSizesForGroup, ==
 *  actualCutSizesForGroup sejak item 18.1 -- fallback ke target rencana MRP sudah dihapus) dikurangi
 *  Finish Good yang sudah tercatat. Dipakai bareng oleh confirmFgDoneAction (TAHAP 1),
 *  updateBatchToCuttingAction (kalau hasil cutting diedit SETELAH tahap 1, lihat item 18.3), dan
 *  closeProductionPoAction (item 21, Close PO per PO Produksi). SELALU hapus dulu baris auto-reject
 *  lama grup ini sebelum insert yang baru, supaya tidak menumpuk (mis. Selesai -> Buka kunci ->
 *  Selesai lagi, atau edit hasil cutting berkali-kali). `scope` boleh dioper dari pemanggil yang
 *  sudah fetch duluan (mis. confirmFgDoneAction) supaya tidak query 2x. */
async function recomputeAutoRejectForGroup(
  db: SupabaseClient,
  groupKey: string,
  mrpId: string,
  vendorProduksi: string,
  warna: string,
  lengan: Lengan,
  scope?: { mrpDetail: MrpDetail; batches: ProductionBatch[]; results: ProductionResult[] }
): Promise<void> {
  const s = scope ?? (await fetchProductionScopeForMrp(db, mrpId, vendorProduksi));
  const target = cuttingSizesForGroup(mrpId, warna, lengan, [s.mrpDetail], s.batches);
  const fgRecorded = cumulativeSizeQtyForGroup(groupKey, "FG", s.results);
  const rejectSizeQty: Record<string, number> = {};
  for (const [size, t] of Object.entries(target)) {
    const shortfall = t - (fgRecorded[size] ?? 0);
    if (shortfall > 0) rejectSizeQty[size] = shortfall;
  }

  const { data: oldAutoRejects } = await db.from("production_results").select("id").eq("group_key", groupKey).eq("kind", "REJECT").is("note", null);
  if (oldAutoRejects && oldAutoRejects.length > 0) {
    await db.from("production_results").delete().in("id", oldAutoRejects.map((r) => r.id));
  }

  if (Object.keys(rejectSizeQty).length > 0) {
    const { data: maklonRow } = await db.from("maklon_pos").select("id").eq("mrp_id", mrpId).eq("vendor_produksi", vendorProduksi).maybeSingle();
    const id = await nextReadableId("PR");
    await db.from("production_results").insert({ id, group_key: groupKey, mrp_id: mrpId, vendor_produksi: vendorProduksi, po_id: maklonRow?.id ?? "", warna, lengan, kind: "REJECT", recorded_at: nowIso() });
    await db.from("production_result_sizes").insert(Object.entries(rejectSizeQty).map(([size, qty]) => ({ production_result_id: id, size, qty })));
  }
}

/** TAHAP 1 dari 2 -- diklik dari tab FINISH GOOD begitu input Finish Good untuk 1 warna/lengan
 *  memang sudah final (tidak akan nambah lagi). Menghitung reject otomatis (cutting AKTUAL
 *  dikurangi Finish Good yang sudah diinput, lewat recomputeAutoRejectForGroup) dan menyimpannya
 *  ke production_results, TAPI SENGAJA belum mengunci Rework/Buang ke Sisa -- itu baru dikunci di
 *  TAHAP 2 (markProductionGroupDoneAction, tab Final Produksi), supaya reject yang baru dihitung di
 *  sini masih sempat dirework jadi baju (ukuran/lengan lain) sebelum benar-benar final. Lihat
 *  migration 0013_production_group_fg_confirmed.sql untuk kolom fg_confirmed_at.
 *
 *  Item 18.2: baseline reject SEKARANG SELALU hasil cutting AKTUAL (actualCutSizesForGroup, lewat
 *  cuttingSizesForGroup yang sejak item 18.1 tidak fallback ke target rencana MRP lagi). Kalau
 *  grup ini punya batch yang SUDAH dicutting tapi belum SATU PUN diisi hasil cuttingnya (baseline
 *  kosong padahal ada batch tercutting), TOLAK -- dulu ini diam-diam jatuh balik ke target rencana
 *  MRP, itu ROOT CAUSE reject dobel-hitung (target 10, cutting aktual 8, FG 6 -> reject tampil 4,
 *  seharusnya 2). Grup TANPA batch cutting sama sekali (murni grup TUJUAN rework lintas lengan,
 *  lihat warnaLenganGroupsWithFg) baseline-nya memang kosong -- itu SAH, reject 0, tetap boleh
 *  confirm. */
export async function confirmFgDoneAction(groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const scope = await fetchProductionScopeForMrp(db, mrpId, vendorProduksi);

  const hasCutBatches = scope.batches.some((b) => b.mrpId === mrpId && b.warna === warna && b.lengan === lengan && b.cuttingAt);
  const baseline = actualCutSizesForGroup(mrpId, warna, lengan, scope.batches);
  if (hasCutBatches && Object.keys(baseline).length === 0) {
    throw new Error('Isi "Input Hasil Cutting" untuk semua roll grup ini dulu — reject dihitung dari hasil cutting aktual, bukan dari target PO/MRP.');
  }

  await recomputeAutoRejectForGroup(db, groupKey, mrpId, vendorProduksi, warna, lengan, scope);

  const { data: existing } = await db.from("production_group_meta").select("group_key").eq("group_key", groupKey).maybeSingle();
  if (existing) await db.from("production_group_meta").update({ fg_confirmed_at: today() }).eq("group_key", groupKey);
  else await db.from("production_group_meta").insert({ group_key: groupKey, mrp_id: mrpId, vendor_produksi: vendorProduksi, warna, lengan, fg_confirmed_at: today() });

  await maybeAdvanceMaklonToDelivery(mrpId, vendorProduksi);
}

/** Kebalikan confirmFgDoneAction -- buka kunci Finish Good grup ini supaya bisa input lagi.
 *  Ditolak kalau: (a) TAHAP 2 (Final Produksi) sudah dikunci duluan -- harus dibuka dulu di sana
 *  (undoProductionGroupDoneAction) sebelum bisa buka tahap 1; atau (b) reject hasil hitungan di
 *  sini SUDAH SEMPAT dirework/dibuang -- membuka lagi bisa bikin data reject/rework tidak
 *  konsisten (deduksi rework tanpa reject dasar yang jelas), jadi diblokir sebagai pengaman. */
export async function undoFgConfirmAction(groupKey: string): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const { data: meta } = await db.from("production_group_meta").select("done_at").eq("group_key", groupKey).maybeSingle();
  if (meta?.done_at) {
    throw new Error('Grup ini sudah "Selesai Produksi" di tab Final Produksi -- buka kunci itu dulu sebelum bisa buka kunci Finish Good.');
  }
  // reworkQtyForGroup/wasteQtyForGroup cuma butuh production_results GRUP INI (kind/groupKey/
  // sizeQty/note) -- di-scope by group_key langsung, bukan getFlowSnapshot() penuh.
  const { data: groupResultRows } = await db
    .from("production_results")
    .select("group_key, kind, note, production_result_sizes(size,qty)")
    .eq("group_key", groupKey);
  const groupResults: Pick<ProductionResult, "groupKey" | "kind" | "note" | "sizeQty">[] = (groupResultRows ?? []).map((r) => {
    const sizeQty: Record<string, number> = {};
    for (const s of r.production_result_sizes ?? []) sizeQty[s.size] = s.qty;
    return { groupKey: r.group_key, kind: r.kind, note: r.note ?? undefined, sizeQty };
  });
  if (reworkQtyForGroup(groupKey, groupResults as ProductionResult[]) > 0 || wasteQtyForGroup(groupKey, groupResults as ProductionResult[]) > 0) {
    throw new Error("Sebagian reject grup ini sudah dirework/dibuang ke sisa -- tidak bisa dibuka lagi supaya data reject tidak jadi tidak konsisten.");
  }
  const { data: oldAutoRejects } = await db.from("production_results").select("id").eq("group_key", groupKey).eq("kind", "REJECT").is("note", null);
  if (oldAutoRejects && oldAutoRejects.length > 0) {
    await db.from("production_results").delete().in("id", oldAutoRejects.map((r) => r.id));
  }
  await db.from("production_group_meta").update({ fg_confirmed_at: null }).eq("group_key", groupKey);
}

/** TAHAP 2 dari 2 -- diklik dari tab FINAL PRODUKSI, SETELAH rework/buang ke sisa (kalau ada)
 *  juga sudah selesai. Ini yang benar-benar mengunci grup (Finish Good/Reject/Rework/Waste tidak
 *  bisa berubah lagi -- lihat guard di reworkRejectSizeAction/wasteRejectSizeAction). Butuh
 *  fg_confirmed_at (TAHAP 1) sudah terisi duluan -- reject tidak dihitung ulang di sini lagi,
 *  itu sudah tugas confirmFgDoneAction. PENTING (item 22, direvisi dari desain awal sesi ini):
 *  `done_at` di sini BUKAN LAGI gate Pengiriman -- FG sudah shippable begitu fg_confirmed_at
 *  (TAHAP 1) terisi (lihat gate di availableFgToShip di lib/mrp/derive.ts). `done_at` sekarang
 *  murni kunci final + basis status tepat-waktu/telat (productionStatusFromDates). */
export async function markProductionGroupDoneAction(groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan): Promise<void> {
  // warna/lengan dipertahankan di signature (dipanggil dgn argumen yang sama seperti
  // confirmFgDoneAction dari UI) walau tidak dipakai lagi di sini -- reject sudah dihitung di
  // TAHAP 1 (confirmFgDoneAction), bukan tugas action ini lagi.
  void warna;
  void lengan;
  await requireVendorSession();
  const db = supabaseServer();
  const { data: existing } = await db.from("production_group_meta").select("group_key,fg_confirmed_at").eq("group_key", groupKey).maybeSingle();
  if (!existing?.fg_confirmed_at) {
    throw new Error('Selesaikan dulu Finish Good ("Selesai Produksi" di tab Finish Good) sebelum bisa Selesai Produksi di sini -- supaya reject sempat dihitung & dirework dulu kalau perlu.');
  }
  await db.from("production_group_meta").update({ done_at: today() }).eq("group_key", groupKey);
  await maybeAdvanceMaklonToDelivery(mrpId, vendorProduksi);
}

/** Item 21 (feedback batch 2026-09-04): "Close PO" untuk siklus produksi PARSIAL -- menutup SATU
 *  PO Produksi (mrpId+vendorProduksi) sekaligus, SEMUA warna/lengan-nya bersamaan (bukan satu per
 *  satu, sesuai keputusan OQ6a). Reference pattern: closePoWithReasonAction (Procurement, PO
 *  Material) -- reason wajib, audit row `maklon_po_cancelled_lines`, notifikasi.
 *
 *  Langkah: (a) reason wajib; (b) tiap grup warna/lengan PO ini yang BELUM `done_at` -- kalau
 *  belum `fg_confirmed_at` juga, hitung reject dulu (recomputeAutoRejectForGroup, item 18.4) baru
 *  isi fg_confirmed_at, lalu set done_at (mengunci grup itu, sama seperti TAHAP 2 biasa); (c) set
 *  closed_at/close_reason di maklon_pos; (d) audit row; (e) notifikasi procurement+finance+vendor.
 *
 *  Item 22 (REVISI dari draft awal): closed_at di sini JUGA memblokir Pengiriman -- termasuk FG
 *  yang SUDAH fgConfirmed sebelum ditutup tapi belum sempat masuk koli (lihat gate di
 *  availableFgToShip, derive.ts). Koli yang sudah dibuat/terkirim SEBELUM PO ditutup tidak
 *  terpengaruh (itu sudah masa lalu). */
export async function closeProductionPoAction(maklonPoId: string, reason: string): Promise<void> {
  const vendorId = await requireVendorSession();
  if (!reason || !reason.trim()) throw new Error("Alasan penutupan PO wajib diisi.");
  const db = supabaseServer();
  const { data: po } = await db.from("maklon_pos").select("id,mrp_id,vendor_produksi,closed_at").eq("id", maklonPoId).maybeSingle();
  if (!po) throw new Error("PO Produksi tidak ditemukan.");
  if (po.vendor_produksi !== vendorId) throw new Error("PO ini bukan milik vendor Anda.");
  if (po.closed_at) return;

  const scope = await fetchProductionScopeForMrp(db, po.mrp_id, po.vendor_produksi);
  const groups = warnaLenganGroupsWithFg(po.mrp_id, po.vendor_produksi, scope.batches, scope.results);
  for (const g of groups) {
    const groupKey = `${po.mrp_id}|${g.warna}|${g.lengan}`;
    const { data: meta } = await db.from("production_group_meta").select("group_key,fg_confirmed_at,done_at").eq("group_key", groupKey).maybeSingle();
    if (meta?.done_at) continue;
    if (!meta?.fg_confirmed_at) {
      await recomputeAutoRejectForGroup(db, groupKey, po.mrp_id, po.vendor_produksi, g.warna, g.lengan, scope);
    }
    if (meta) {
      await db.from("production_group_meta").update({ fg_confirmed_at: meta.fg_confirmed_at ?? today(), done_at: today() }).eq("group_key", groupKey);
    } else {
      await db
        .from("production_group_meta")
        .insert({ group_key: groupKey, mrp_id: po.mrp_id, vendor_produksi: po.vendor_produksi, warna: g.warna, lengan: g.lengan, fg_confirmed_at: today(), done_at: today() });
    }
  }

  await db.from("maklon_pos").update({ closed_at: today(), close_reason: reason.trim() }).eq("id", maklonPoId);
  await db.from("maklon_po_cancelled_lines").insert({ maklon_po_id: maklonPoId, note: `Close PO: ${reason.trim()}`, rolls: 0, from_vendor: "Vendor Produksi", time: nowClock() });
  await insertNotification(
    notif(`PO Produksi ${maklonPoId} (${po.mrp_id}) ditutup oleh vendor — alasan: ${reason.trim()}. Sisa Finish Good yang belum masuk koli tidak bisa dikirim lagi.`, ["procurement", "finance"])
  );
  await insertNotification(notif(`PO Produksi ${maklonPoId} (${po.mrp_id}) sudah Anda tutup (Close PO) — alasan: ${reason.trim()}.`, ["vendorMaklon"], po.vendor_produksi));
}

// =========================================================================
// Delivery
// =========================================================================

export async function createDeliveryKoliAction(input: { mrpId: string; vendorProduksi: string; ekspedisi: string; noKoli: string; items: DeliveryKoliItem[] }): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const id = await nextReadableId("KOLI");
  const { error } = await db.from("delivery_kolis").insert({ id, mrp_id: input.mrpId, vendor_produksi: input.vendorProduksi, ekspedisi: input.ekspedisi, no_koli: input.noKoli, created_at: today() });
  if (error) throw new Error(error.message);
  if (input.items.length > 0) {
    await db.from("delivery_koli_items").insert(input.items.map((it) => ({ delivery_koli_id: id, warna: it.warna, lengan: it.lengan, size: it.size, qty: it.qty, kind: it.kind, usia: it.usia ?? null })));
  }
}

export async function setKoliWeightAction(koliId: string, beratKoli: number): Promise<void> {
  await requireVendorSession();
  const { error } = await supabaseServer().from("delivery_kolis").update({ berat_koli: beratKoli }).eq("id", koliId);
  if (error) throw new Error(error.message);
}

export async function markKoliDeliveredAction(koliId: string): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const { data: koli } = await db.from("delivery_kolis").select("berat_koli").eq("id", koliId).single();
  if (!koli?.berat_koli) return;
  await db.from("delivery_kolis").update({ delivered_at: today() }).eq("id", koliId);
}

// =========================================================================
// Vendor invoice (billing aktif)
// =========================================================================

export async function createVendorInvoiceAction(input: { vendorProduksi: string; lines: { mrpId: string; warna: string; lengan: Lengan; usia?: Usia; qty: number; ratePerPc: number }[]; note?: string }): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  if (input.lines.length === 0) return;
  const id = await nextReadableId("VINV");
  const totalTagihan = input.lines.reduce((s, l) => s + l.qty * l.ratePerPc, 0);
  const { error } = await db.from("vendor_invoices").insert({
    id,
    vendor_produksi: input.vendorProduksi,
    total_tagihan: totalTagihan,
    net_tagihan: totalTagihan,
    status: "SUBMITTED",
    note: input.note ?? null,
    submitted_at: today(),
  });
  if (error) throw new Error(error.message);
  await db.from("vendor_invoice_lines").insert(
    input.lines.map((l) => ({ vendor_invoice_id: id, mrp_id: l.mrpId, warna: l.warna, lengan: l.lengan, usia: l.usia ?? null, qty: l.qty, rate_per_pc: l.ratePerPc, amount: l.qty * l.ratePerPc }))
  );
  await insertNotification(notif(`Invoice vendor baru ${id} menunggu review Procurement`, ["procurement"]));
}

export async function setVendorInvoiceStatusAction(invoiceId: string, status: "SUBMITTED" | "REVISION" | "APPROVED" | "PAID"): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const { data: invoice } = await db.from("vendor_invoices").select("id,vendor_produksi").eq("id", invoiceId).single();
  await db
    .from("vendor_invoices")
    .update({ status, approved_at: status === "APPROVED" ? today() : undefined, paid_at: status === "PAID" ? today() : undefined })
    .eq("id", invoiceId);
  if (invoice && status === "APPROVED") await insertNotification(notif(`Invoice vendor ${invoice.id} disetujui Procurement — menunggu payment Finance`, ["finance", "vendorMaklon"], invoice.vendor_produksi));
  if (invoice && status === "PAID") await insertNotification(notif(`Invoice vendor ${invoice.id} telah dibayar Finance`, ["vendorMaklon"], invoice.vendor_produksi));
}

export async function payVendorInvoiceAction(invoiceId: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const { data: invoice } = await db.from("vendor_invoices").select("id,vendor_produksi,status").eq("id", invoiceId).single();
  if (!invoice || invoice.status === "PAID") return;
  await db.from("vendor_invoices").update({ status: "PAID", paid_at: today() }).eq("id", invoiceId);
  await insertNotification(notif(`Invoice vendor ${invoice.id} telah dibayar lunas oleh Finance`, ["vendorMaklon"], invoice.vendor_produksi));
}

export async function addVendorInvoiceAdjustmentAction(invoiceId: string, input: { kind: VendorInvoiceAdjustmentKind; label: string; amount: number; note?: string }): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const { data: invoice } = await db.from("vendor_invoices").select("id,vendor_produksi").eq("id", invoiceId).single();
  if (!invoice) return;
  const id = await nextReadableId("ADJ");
  await db.from("vendor_invoice_adjustments").insert({ id, vendor_invoice_id: invoiceId, kind: input.kind, label: input.label, amount: input.amount, note: input.note ?? null, added_at: today() });
  const text =
    input.kind === "TIDAK_ADA"
      ? `Catatan ditambahkan Procurement pada invoice ${invoice.id}: ${input.label} (tanpa sanksi)`
      : `${input.kind === "DENDA" ? "Denda" : "Reward"} ditambahkan Procurement pada invoice ${invoice.id}: ${input.label} (Rp ${input.amount.toLocaleString("id-ID")})`;
  await insertNotification(notif(text, ["vendorMaklon"], invoice.vendor_produksi));
}

// =========================================================================
// Notifikasi
// =========================================================================

export async function markNotificationReadAction(id: string): Promise<void> {
  await requireSession();
  const { error } = await supabaseServer().from("notifications").update({ read: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsReadAction(ids: string[]): Promise<void> {
  await requireSession();
  if (ids.length === 0) return;
  const { error } = await supabaseServer().from("notifications").update({ read: true }).in("id", ids);
  if (error) throw new Error(error.message);
}

export async function dismissNotificationAction(id: string): Promise<void> {
  await requireSession();
  const { error } = await supabaseServer().from("notifications").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Hapus SEMUA data bisnis di Supabase (dipakai bersama semua modul & vendor) -- CATATAN
 *  MIGRASI: dulu tombol ini cuma menghapus localStorage BROWSER SENDIRI (aman, cuma data lokal
 *  yang hilang). Sekarang datanya dipakai bersama, jadi ini benar-benar menghapus punya semua
 *  orang -- konfirmasi WAJIB ditampilkan di client SEBELUM memanggil ini (lihat
 *  components/shell/reset-data-button.tsx). Kredensial vendor (vendors_produksi) TIDAK ikut
 *  dihapus -- itu bukan "data bisnis", itu akun login.
 */
export async function resetAllAction(): Promise<void> {
  await requireSession(); // siapa saja yang sudah login (role apapun / vendor) boleh -- sama seperti perilaku lama
  const db = supabaseServer();
  // vendor_invoices dihapus DULU -- vendor_invoice_lines beracuan ke mrp_id (cascade lewat mrp),
  // tapi baris vendor_invoices sendiri TIDAK beracuan ke mrp -- kalau mrp dihapus duluan, baris
  // vendor_invoices bakal jadi "cangkang kosong" tanpa lines, bukan ikut terhapus.
  await db.from("vendor_invoices").delete().neq("id", "");
  // Hapus mrp -- cascade ke SEMUA tabel turunannya (lengan_groups, aduan_pola_rows, material_rows,
  // material_pos, maklon_pos, raw_material_invoices, maklon_invoices, production_batches,
  // production_results, production_group_meta, delivery_kolis, dst -- lihat FK ON DELETE CASCADE
  // di supabase/migrations/0001_init.sql).
  await db.from("mrp").delete().neq("id", "");
  await db.from("notifications").delete().neq("id", "");
  // Master data (bukan vendors_produksi) -- persis initialState lama (semua balik ke []).
  await db.from("harga_maklon").delete().neq("id", "");
  await db.from("harga_kain").delete().neq("id", "");
  await db.from("harga_kain_pks").delete().neq("id", "");
  await db.from("entitas").delete().neq("id", "");
  await db.from("suppliers").delete().neq("id", "");
}

export async function getFlowSnapshotAction() {
  await requireSession();
  return getFlowSnapshot();
}

// =========================================================================
// Master Data CRUD (lib/mrp/masterData.ts) -- satu tabel per fungsi, tanpa business logic,
// dipakai halaman Master Data (add/update/delete satu baris) & tombol "Import dari Google
// Sheets" (replaceX -- ganti SELURUH tabel, bukan merge, persis perilaku lama).
// =========================================================================
import type { EntitasRow, HargaKainPksRow, HargaKainRow, HargaMaklonRow, SupplierRow } from "./masterData";

async function requireMasterDataRole() {
  const session = await requireSession();
  if (!session.internalRoles.some((r) => r === "procurement" || r === "finance")) {
    throw new Error("Forbidden: Master Data hanya bisa diubah dari modul Procurement/Finance.");
  }
}

export async function addHargaMaklonRowAction(): Promise<void> {
  await requireMasterDataRole();
  const id = await nextReadableId("HMKL");
  await supabaseServer().from("harga_maklon").insert({ id, kode_vendor: "", nama_vendor: "", tipe_lengan: "PDK", jenis_harga: "Standar", harga: 0 });
}
export async function updateHargaMaklonRowAction(id: string, patch: Partial<HargaMaklonRow>): Promise<void> {
  await requireMasterDataRole();
  const p: Record<string, unknown> = {};
  if (patch.kodeVendor !== undefined) p.kode_vendor = patch.kodeVendor;
  if (patch.namaVendor !== undefined) p.nama_vendor = patch.namaVendor;
  if (patch.tipeLengan !== undefined) p.tipe_lengan = patch.tipeLengan;
  if (patch.jenisHarga !== undefined) p.jenis_harga = patch.jenisHarga;
  if (patch.kapasitasMin !== undefined) p.kapasitas_min = patch.kapasitasMin;
  if (patch.kapasitasMax !== undefined) p.kapasitas_max = patch.kapasitasMax;
  if (patch.harga !== undefined) p.harga = patch.harga;
  await supabaseServer().from("harga_maklon").update(p).eq("id", id);
}
export async function deleteHargaMaklonRowAction(id: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("harga_maklon").delete().eq("id", id);
}
export async function replaceHargaMaklonAction(rows: HargaMaklonRow[]): Promise<void> {
  await requireMasterDataRole();
  const db = supabaseServer();
  await db.from("harga_maklon").delete().neq("id", "");
  if (rows.length === 0) return;
  const ids = await Promise.all(rows.map(() => nextReadableId("HMKL")));
  await db.from("harga_maklon").insert(
    rows.map((r, i) => ({ id: ids[i], kode_vendor: r.kodeVendor, nama_vendor: r.namaVendor, tipe_lengan: r.tipeLengan, jenis_harga: r.jenisHarga, kapasitas_min: r.kapasitasMin ?? null, kapasitas_max: r.kapasitasMax ?? null, harga: r.harga }))
  );
}

export async function addHargaKainRowAction(): Promise<void> {
  await requireMasterDataRole();
  const id = await nextReadableId("HKAIN");
  await supabaseServer().from("harga_kain").insert({ id, kode_supplier: "", nama_supplier: "", kategori: "", warna: "", harga_per_kg: 0 });
}
export async function updateHargaKainRowAction(id: string, patch: Partial<HargaKainRow>): Promise<void> {
  await requireMasterDataRole();
  const p: Record<string, unknown> = {};
  if (patch.kodeSupplier !== undefined) p.kode_supplier = patch.kodeSupplier;
  if (patch.namaSupplier !== undefined) p.nama_supplier = patch.namaSupplier;
  if (patch.kategori !== undefined) p.kategori = patch.kategori;
  if (patch.warna !== undefined) p.warna = patch.warna;
  if (patch.hargaPerKg !== undefined) p.harga_per_kg = patch.hargaPerKg;
  await supabaseServer().from("harga_kain").update(p).eq("id", id);
}
export async function deleteHargaKainRowAction(id: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("harga_kain").delete().eq("id", id);
}
export async function replaceHargaKainAction(rows: HargaKainRow[]): Promise<void> {
  await requireMasterDataRole();
  const db = supabaseServer();
  await db.from("harga_kain").delete().neq("id", "");
  if (rows.length === 0) return;
  const ids = await Promise.all(rows.map(() => nextReadableId("HKAIN")));
  await db.from("harga_kain").insert(rows.map((r, i) => ({ id: ids[i], kode_supplier: r.kodeSupplier, nama_supplier: r.namaSupplier, kategori: r.kategori, warna: r.warna, harga_per_kg: r.hargaPerKg })));
}

export async function addHargaKainPksRowAction(): Promise<void> {
  await requireMasterDataRole();
  const id = await nextReadableId("HKPKS");
  await supabaseServer().from("harga_kain_pks").insert({ id, kode_supplier: "", kategori: "", warna: "", satuan: "TON", harga_per_kg: 0 });
}
export async function updateHargaKainPksRowAction(id: string, patch: Partial<HargaKainPksRow>): Promise<void> {
  await requireMasterDataRole();
  const p: Record<string, unknown> = {};
  if (patch.kodeSupplier !== undefined) p.kode_supplier = patch.kodeSupplier;
  if (patch.kategori !== undefined) p.kategori = patch.kategori;
  if (patch.warna !== undefined) p.warna = patch.warna;
  if (patch.satuan !== undefined) p.satuan = patch.satuan;
  if (patch.tonaseMin !== undefined) p.tonase_min = patch.tonaseMin;
  if (patch.tonaseMax !== undefined) p.tonase_max = patch.tonaseMax;
  if (patch.hargaPerKg !== undefined) p.harga_per_kg = patch.hargaPerKg;
  await supabaseServer().from("harga_kain_pks").update(p).eq("id", id);
}
export async function deleteHargaKainPksRowAction(id: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("harga_kain_pks").delete().eq("id", id);
}
export async function replaceHargaKainPksAction(rows: HargaKainPksRow[]): Promise<void> {
  await requireMasterDataRole();
  const db = supabaseServer();
  await db.from("harga_kain_pks").delete().neq("id", "");
  if (rows.length === 0) return;
  const ids = await Promise.all(rows.map(() => nextReadableId("HKPKS")));
  await db
    .from("harga_kain_pks")
    .insert(rows.map((r, i) => ({ id: ids[i], kode_supplier: r.kodeSupplier, kategori: r.kategori, warna: r.warna, satuan: r.satuan, tonase_min: r.tonaseMin ?? null, tonase_max: r.tonaseMax ?? null, harga_per_kg: r.hargaPerKg })));
}

export async function addEntitasAction(nama: string): Promise<void> {
  await requireMasterDataRole();
  const id = await nextReadableId("ENT");
  await supabaseServer().from("entitas").insert({ id, nama });
}
export async function updateEntitasAction(id: string, nama: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("entitas").update({ nama }).eq("id", id);
}
export async function deleteEntitasAction(id: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("entitas").delete().eq("id", id);
}
export async function replaceEntitasAction(rows: EntitasRow[]): Promise<void> {
  await requireMasterDataRole();
  const db = supabaseServer();
  await db.from("entitas").delete().neq("id", "");
  if (rows.length === 0) return;
  const ids = await Promise.all(rows.map(() => nextReadableId("ENT")));
  await db.from("entitas").insert(rows.map((r, i) => ({ id: ids[i], nama: r.nama })));
}

export async function addSupplierAction(nama: string): Promise<void> {
  await requireMasterDataRole();
  const id = await nextReadableId("SUP");
  await supabaseServer().from("suppliers").insert({ id, nama });
}
export async function updateSupplierAction(id: string, nama: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("suppliers").update({ nama }).eq("id", id);
}
export async function deleteSupplierAction(id: string): Promise<void> {
  await requireMasterDataRole();
  await supabaseServer().from("suppliers").delete().eq("id", id);
}
export async function replaceSupplierAction(rows: SupplierRow[]): Promise<void> {
  await requireMasterDataRole();
  const db = supabaseServer();
  await db.from("suppliers").delete().neq("id", "");
  if (rows.length === 0) return;
  const ids = await Promise.all(rows.map(() => nextReadableId("SUP")));
  await db.from("suppliers").insert(rows.map((r, i) => ({ id: ids[i], nama: r.nama })));
}
