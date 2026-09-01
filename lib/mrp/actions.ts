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

import { requireSession, requireInternalRole } from "../auth/session";
import { supabaseServer } from "../supabase/server";
import { nextReadableId } from "./repo/ids";
import { getFlowSnapshot } from "./repo/snapshot";
import {
  localDateString,
  maklonAmountForLenganBuckets,
  maklonAmountForVendor,
  materialAmountForPo,
  materialClaimsList,
  splitMaterialPoByEntitas,
  advanceMaklonToDeliveryIfFullyDone,
  reassignAduanRowsVendor,
  targetSizesForGroup,
  cumulativeSizeQtyForGroup,
} from "./derive";
import { ENTITAS_LIST } from "./seed";
import type { ParsedMrpImport } from "./parseImport";
import type { AddBuyItem, ColorBreakdown, ColorEntry, DeliveryKoliItem, Lengan, MaterialPO, Notification, NotificationAudience, Usia, VendorInvoiceAdjustmentKind } from "./types";

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

export async function assignMaterialSupplierAction(mrpId: string, materialRowId: string, supplier: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const { error } = await supabaseServer().from("material_rows").update({ supplier }).eq("id", materialRowId).eq("mrp_id", mrpId);
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
  const snapshot = await getFlowSnapshot();
  const detail = snapshot.mrpDetails.find((d) => d.mrp.id === mrpId);
  if (!detail) throw new Error("MRP tidak ditemukan.");

  const vendorRows = new Map<string, typeof detail.aduanRows>();
  for (const a of detail.aduanRows) vendorRows.set(a.vendor, [...(vendorRows.get(a.vendor) ?? []), a]);

  const maklonPoIds = await Promise.all(Array.from(vendorRows.keys()).map(() => nextReadableId("PO-MKL")));
  const maklonPOs = Array.from(vendorRows.entries()).map(([vendor, rows], idx) => ({
    id: maklonPoIds[idx],
    mrpId,
    vendorProduksi: vendor,
    qty: rows.reduce((s, r) => s + r.qty, 0),
    amount: maklonAmountForVendor(snapshot.hargaMaklon, vendor, rows),
    entity: "PT Tigalapan Sukses Indo",
    status: "FULL_WAITING_MATERIAL" as const,
    approved: false,
  }));

  const pairTotals = new Map<string, { vendor: string; supplier: string; rolls: number; colorMap: Map<string, ColorBreakdown> }>();
  const defaultEntitas = snapshot.entitasList[0]?.nama ?? ENTITAS_LIST[0];
  for (const a of detail.aduanRows) {
    const mr = detail.materialRows.find((m) => m.lenganGroupId === a.lenganGroupId);
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
      amount: materialAmountForPo(snapshot.hargaKain, snapshot.hargaKainPks, p.supplier, colorBreakdown),
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

export async function approveMaterialPoAction(id: string): Promise<void> {
  await requireInternalRole(await requireSession(), "finance");
  const db = supabaseServer();
  const snapshot = await getFlowSnapshot();
  const po = snapshot.materialPOs.find((p) => p.id === id);
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
      await db.from("raw_material_invoice_rolls").delete().in("invoice_color_id", inv.colorEntries.map((c) => `${inv.id}-${c.warna}-${c.lengan}`));
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
        const movedCount = c.rolls.length;
        await db.from("raw_material_invoice_rolls").delete().eq("invoice_color_id", colorId).in(
          "roll_index",
          Array.from({ length: movedCount }, (_, i) => i)
        );
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
          entity: "PT Tigalapan Sukses Indo",
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

export async function setInvoicesDeliveryAction(invoiceIds: string[], deliveryDate: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const { data: invoices } = await db.from("raw_material_invoices").select("id,status").in("id", invoiceIds);
  for (const inv of invoices ?? []) {
    if (inv.status === "PAID") await db.from("raw_material_invoices").update({ status: "DELIVERY", delivered_at: deliveryDate }).eq("id", inv.id);
  }
}

export async function receiveRawMaterialRollAction(
  invoiceId: string,
  warna: string,
  lengan: Lengan,
  rollIndex: number,
  netKg: number,
  codeRoll?: string,
  codeLot?: string,
  claim?: { diffKg: number; pct: number }
): Promise<void> {
  const vendorId = await requireVendorSession();
  const db = supabaseServer();
  const colorId = `${invoiceId}-${warna}-${lengan}`;
  const { error } = await db
    .from("raw_material_invoice_rolls")
    .update({ net_kg: netKg, received_at: today(), code_roll: codeRoll ?? null, code_lot: codeLot ?? null })
    .eq("invoice_color_id", colorId)
    .eq("roll_index", rollIndex);
  if (error) throw new Error(error.message);

  const { data: inv } = await db.from("raw_material_invoices").select("id,status,po_id,received_at").eq("id", invoiceId).single();
  if (inv) {
    await db
      .from("raw_material_invoices")
      .update({ status: inv.status === "DELIVERY" ? "RECEIVING" : inv.status, received_at: inv.received_at ?? today() })
      .eq("id", invoiceId);
  }
  if (claim) {
    await insertNotification(
      notif(
        `Claim selisih berat — ${inv?.po_id ?? ""} ${warna} · ${lengan} roll ${rollIndex + 1}: selisih ${claim.diffKg >= 0 ? "+" : ""}${claim.diffKg.toFixed(2)} kg (${claim.pct.toFixed(1)}%) di luar toleransi. Kode roll: ${codeRoll || "-"}, lot: ${codeLot || "-"}.`,
        ["procurement"]
      )
    );
  }
  void vendorId;
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
  const snapshot = await getFlowSnapshot();
  const toApprove = snapshot.materialPOs.filter((po) => !po.approved && po.status !== "CANCELLED");
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
  const snapshot = await getFlowSnapshot();
  const toApprove = snapshot.materialPOs.filter((po) => po.mrpId === mrpId && po.vendorProduksi === vendor && !po.approved && po.status !== "CANCELLED");
  for (const po of toApprove) {
    const distinctEntitas = new Set(po.colorBreakdown.map((c) => c.entitas ?? po.entity));
    const newIds = await Promise.all(Array.from({ length: Math.max(0, distinctEntitas.size - 1) }).map(() => nextReadableId("PO-SUP")));
    const parts = splitMaterialPoByEntitas(po, newIds).map((p) => ({ ...p, approved: true }));
    await writeMaterialPoSplit(db, po.id, parts);
  }
  await checkPoApproved(mrpId);
}

export async function updateBatchToCuttingAction(batchId: string, cuttingAt: string): Promise<void> {
  await requireVendorSession();
  const { error } = await supabaseServer().from("production_batches").update({ cutting_at: cuttingAt }).eq("id", batchId);
  if (error) throw new Error(error.message);
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
function parseClaimKey(key: string): { invoiceColorId: string; rollIndex: number } | null {
  const parts = key.split("|");
  if (parts.length !== 4) return null;
  const [invoiceId, warna, lengan, rollIndexStr] = parts;
  return { invoiceColorId: `${invoiceId}-${warna}-${lengan}`, rollIndex: parseInt(rollIndexStr, 10) };
}

export async function resolveMaterialClaimAction(key: string, note: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const { error } = await supabaseServer()
    .from("raw_material_invoice_rolls")
    .update({ claim_resolved_note: note, claim_resolved_at: today() })
    .eq("invoice_color_id", parsed.invoiceColorId)
    .eq("roll_index", parsed.rollIndex);
  if (error) throw new Error(error.message);
}

export async function unresolveMaterialClaimAction(key: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  await supabaseServer().from("raw_material_invoice_rolls").update({ claim_resolved_note: null, claim_resolved_at: null }).eq("invoice_color_id", parsed.invoiceColorId).eq("roll_index", parsed.rollIndex);
}

export async function requestMaterialClaimReturAction(key: string, note: string): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const parsed = parseClaimKey(key);
  if (!parsed) return;
  const db = supabaseServer();
  await db.from("raw_material_invoice_rolls").update({ claim_retur_note: note, claim_retur_requested_at: today() }).eq("invoice_color_id", parsed.invoiceColorId).eq("roll_index", parsed.rollIndex);
  const snapshot = await getFlowSnapshot();
  const claim = materialClaimsList(snapshot.invoices).find((c) => c.key === key);
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
  await supabaseServer().from("raw_material_invoice_rolls").update({ claim_retur_note: null, claim_retur_requested_at: null }).eq("invoice_color_id", parsed.invoiceColorId).eq("roll_index", parsed.rollIndex);
}

export async function closePoWithReasonAction(poId: string, reason: string, warna: string, lengan: Lengan, closeQty: number): Promise<void> {
  await requireInternalRole(await requireSession(), "procurement");
  const db = supabaseServer();
  const snapshot = await getFlowSnapshot();
  const po = snapshot.materialPOs.find((p) => p.id === poId);
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

  const detail = snapshot.mrpDetails.find((d) => d.mrp.id === po.mrpId);
  let pcsRemoved = 0;
  if (detail) {
    const colorAduanRows = detail.aduanRows.filter((a) => a.vendor === po.vendorProduksi && a.warna === warna && a.lengan === lengan);
    const colorTotalRolls = colorAduanRows.reduce((s, a) => s + a.qtyRoll, 0);
    const colorTotalQty = colorAduanRows.reduce((s, a) => s + a.qty, 0);
    if (colorTotalRolls > 0) pcsRemoved = Math.round(colorTotalQty * (qty / colorTotalRolls));
  }

  await db.from("material_po_color_breakdown").update({ roll_count: newColorBreakdown.find((c) => c.warna === warna && c.lengan === lengan)!.rollCount }).eq("material_po_id", poId).eq("warna", warna).eq("lengan", lengan);
  await db
    .from("material_pos")
    .update({ roll_count: newRollCount, amount: materialAmountForPo(snapshot.hargaKain, snapshot.hargaKainPks, po.supplier, newColorBreakdown), status: fullyClosed ? "CANCELLED" : po.status })
    .eq("id", poId);

  const maklon = snapshot.maklonPOs.find((m) => m.mrpId === po.mrpId && m.vendorProduksi === po.vendorProduksi);
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
  const snapshot = await getFlowSnapshot();
  const po = snapshot.materialPOs.find((p) => p.id === poId);
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

  const newPoColorBreakdown = [{ warna, lengan, rollCount: qty, entitas: colorEntry.entitas ?? po.entity }];
  const newPoId = await nextReadableId("PO-SUP");
  const newPoAmount = materialAmountForPo(snapshot.hargaKain, snapshot.hargaKainPks, newSupplier, newPoColorBreakdown);

  await db.from("material_po_color_breakdown").update({ roll_count: newColorBreakdown.find((c) => c.warna === warna && c.lengan === lengan)!.rollCount }).eq("material_po_id", poId).eq("warna", warna).eq("lengan", lengan);
  await db
    .from("material_pos")
    .update({ roll_count: newRollCount, amount: materialAmountForPo(snapshot.hargaKain, snapshot.hargaKainPks, po.supplier, newColorBreakdown), status: fullyClosed ? "CANCELLED" : po.status })
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

/** Refetch snapshot & jalankan derive.advanceMaklonToDeliveryIfFullyDone (fungsi murni yang sama
 *  persis dipakai UI lama) -- kalau hasilnya bilang PO maklon harus pindah ke DELIVERY, tulis
 *  balik status itu. Dipanggil setelah tiap kali ada ProductionResult baru. */
async function maybeAdvanceMaklonToDelivery(mrpId: string, vendorProduksi: string) {
  const db = supabaseServer();
  const snapshot = await getFlowSnapshot();
  const updated = advanceMaklonToDeliveryIfFullyDone(mrpId, vendorProduksi, snapshot.maklonPOs, snapshot.mrpDetails, snapshot.productionBatches, snapshot.productionResults);
  const before = snapshot.maklonPOs.find((m) => m.mrpId === mrpId && m.vendorProduksi === vendorProduksi);
  const after = updated.find((m) => m.mrpId === mrpId && m.vendorProduksi === vendorProduksi);
  if (before && after && before.status !== after.status) {
    await db.from("maklon_pos").update({ status: after.status }).eq("id", after.id);
  }
}

export async function reworkRejectSizeAction(input: { mrpId: string; vendorProduksi: string; warna: string; lengan: Lengan; fromSize: string; qty: number; toLengan: Lengan; toSize: string; usia: Usia }): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const sourceGroupKey = `${input.mrpId}|${input.warna}|${input.lengan}`;
  const outputGroupKey = `${input.mrpId}|${input.warna}|${input.toLengan}`;
  const { data: metas } = await db.from("production_group_meta").select("group_key,done_at").in("group_key", [sourceGroupKey, outputGroupKey]);
  if ((metas ?? []).some((g) => g.done_at)) return;

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

export async function markProductionGroupDoneAction(groupKey: string, mrpId: string, vendorProduksi: string, warna: string, lengan: Lengan): Promise<void> {
  await requireVendorSession();
  const db = supabaseServer();
  const snapshot = await getFlowSnapshot();

  const target = targetSizesForGroup(mrpId, warna, lengan, snapshot.mrpDetails, snapshot.productionBatches);
  const fgRecorded = cumulativeSizeQtyForGroup(groupKey, "FG", snapshot.productionResults);
  const rejectSizeQty: Record<string, number> = {};
  for (const [size, t] of Object.entries(target)) {
    const shortfall = t - (fgRecorded[size] ?? 0);
    if (shortfall > 0) rejectSizeQty[size] = shortfall;
  }

  // Buang entri auto-reject LAMA punya grup ini (note null = auto-generated, bukan hasil rework
  // manual) sebelum nambah yang baru -- lihat catatan asli di lib/mrp/store.ts soal kenapa ini
  // wajib supaya reject tidak menumpuk saat Done -> Undo -> Done lagi.
  const { data: oldAutoRejects } = await db.from("production_results").select("id").eq("group_key", groupKey).eq("kind", "REJECT").is("note", null);
  if (oldAutoRejects && oldAutoRejects.length > 0) {
    await db.from("production_results").delete().in("id", oldAutoRejects.map((r) => r.id));
  }

  if (Object.keys(rejectSizeQty).length > 0) {
    const maklon = snapshot.maklonPOs.find((m) => m.mrpId === mrpId && m.vendorProduksi === vendorProduksi);
    const id = await nextReadableId("PR");
    await db.from("production_results").insert({ id, group_key: groupKey, mrp_id: mrpId, vendor_produksi: vendorProduksi, po_id: maklon?.id ?? "", warna, lengan, kind: "REJECT", recorded_at: nowIso() });
    await db.from("production_result_sizes").insert(Object.entries(rejectSizeQty).map(([size, qty]) => ({ production_result_id: id, size, qty })));
  }

  const { data: existing } = await db.from("production_group_meta").select("group_key").eq("group_key", groupKey).maybeSingle();
  if (existing) await db.from("production_group_meta").update({ done_at: today() }).eq("group_key", groupKey);
  else await db.from("production_group_meta").insert({ group_key: groupKey, mrp_id: mrpId, vendor_produksi: vendorProduksi, warna, lengan, done_at: today() });

  await maybeAdvanceMaklonToDelivery(mrpId, vendorProduksi);
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
