import * as XLSX from "xlsx";
import type { AduanPolaRow, Lengan, LenganGroup, MaterialRow, SizeQty } from "./types";
import { VENDOR_PRODUKSI } from "./seed";

/** Alias kode vendor lama/spreadsheet -> id resmi di sistem ini. "BY" adalah kode Bayu di
 *  spreadsheet Procurement asli, tapi id internal SENGAJA dipertahankan "BAYU" (lihat komentar di
 *  lib/mrp/seed.ts) demi kompatibilitas data lama (PO, invoice, dst. semua sudah tersimpan pakai
 *  "BAYU") — jadi "BY" perlu dikenali terpisah, tidak akan pernah cocok lewat pencocokan kode/nama
 *  biasa di bawah. Tambah baris baru di sini kalau ketemu kode spreadsheet lain yang beda dari id
 *  internal. */
const VENDOR_CODE_ALIASES: Record<string, string> = { BY: "BAYU" };

/** Cocokkan KODE ATAU NAMA vendor dari Excel (bebas huruf besar/kecil, spasi, atau tanpa strip —
 *  mis. "bayu", "gi01", "Yogi 01") ke id vendor resmi (mis. "BAYU", "GI-01") -- revisi 2026-09-06:
 *  sebelumnya cuma cocok ke KODE, jadi kolom VENDOR yang diisi NAMA lengkap (kadang begitu di
 *  beberapa sheet Procurement) gagal dengan error "tidak dikenali" walau sebenarnya vendornya ada.
 *  Kalau tidak ada yang cocok sama sekali, lempar error jelas — supaya PO/invoice tidak pernah
 *  "hilang" karena kode/nama vendor typo yang diam-diam disimpan apa adanya dan tidak pernah cocok
 *  dengan vendor manapun. */
function normalizeVendorCode(raw: string): string {
  const cleaned = raw.trim();
  const key = cleaned.toUpperCase().replace(/[\s-]/g, "");
  if (VENDOR_CODE_ALIASES[key]) return VENDOR_CODE_ALIASES[key];
  const byCode = Object.keys(VENDOR_PRODUKSI).find((k) => k.toUpperCase().replace(/[\s-]/g, "") === key);
  if (byCode) return byCode;
  const byName = Object.entries(VENDOR_PRODUKSI).find(([, meta]) => meta.name.toUpperCase().replace(/[\s-]/g, "") === key);
  if (byName) return byName[0];
  const valid = Object.entries(VENDOR_PRODUKSI)
    .map(([k, meta]) => `${k} (${meta.name})`)
    .join(", ");
  throw new Error(`Kode/nama vendor "${cleaned}" pada kolom VENDOR tidak dikenali. Vendor yang valid: ${valid}.`);
}

export type ParsedMrpImport = {
  kategori: string;
  warna: string;
  qty: number;
  isFob: boolean;
  lenganGroups: LenganGroup[];
  aduanRows: AduanPolaRow[];
  materialRows: MaterialRow[];
};

const MRP_COLUMNS = ["KATEGORI", "WARNA", "ITEM", "JENIS LENGAN DAN UKURAN", "QTY"];
const ADUAN_COLUMNS = ["WARNA", "LENGAN", "ADUAN POLA", "QTY ROLL"];

function findSheet(wb: XLSX.WorkBook, needle: string) {
  return wb.SheetNames.find((n) => n.toLowerCase().includes(needle));
}

function toLengan(raw: string): Lengan {
  const upper = raw.trim().toUpperCase();
  return upper.startsWith("PANJANG") ? "PANJANG" : "PENDEK";
}

export async function parseMrpImportFile(file: File): Promise<ParsedMrpImport> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const mrpSheetName = findSheet(wb, "mrp") ?? wb.SheetNames[0];
  const aduanSheetName = findSheet(wb, "aduan");
  if (!mrpSheetName) throw new Error("File tidak memiliki sheet data (kosong).");

  const mrpRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[mrpSheetName], { defval: null });
  if (mrpRows.length === 0) throw new Error(`Sheet "${mrpSheetName}" kosong.`);
  const cols = Object.keys(mrpRows[0]);
  const missing = MRP_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length > 0) {
    throw new Error(`Sheet "${mrpSheetName}" tidak sesuai template — kolom hilang: ${missing.join(", ")}`);
  }

  // Kategori FOB dibaca secara posisional dari kolom J (index ke-9) baris data pertama,
  // terlepas dari nama header — sesuai kolom J pada sheet "MRP Template".
  const mrpRowsPositional: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[mrpSheetName], { header: 1, defval: null });
  const firstDataRow = mrpRowsPositional[1] ?? [];
  const colJValue = firstDataRow[9];
  const isFob = String(colJValue ?? "").trim().toUpperCase() === "FOB";

  const groupMap = new Map<string, LenganGroup>();
  for (const row of mrpRows) {
    const warna = String(row["WARNA"] ?? "").trim();
    const jenis = String(row["JENIS LENGAN DAN UKURAN"] ?? "").trim();
    const qty = Number(row["QTY"] ?? 0);
    if (!warna || !jenis) continue;
    const [lenganRaw, ...sizeParts] = jenis.split(/\s+/);
    const lengan = toLengan(lenganRaw);
    const size = sizeParts.join(" ") || lenganRaw;
    const key = warna + "|" + lengan;
    // Item 2026-09-12 (user-reported): kolom VENDOR diisi "-" untuk baris yang memang TIDAK ada
    // pemesanan/produksi (qty 0) -- dulu baris PERTAMA yang ditemukan untuk 1 kombinasi
    // warna+lengan langsung dipakai sebagai vendorDefault grup itu APA ADANYA, jadi kalau baris
    // pertama itu kebetulan placeholder "-", import gagal total ("vendor tidak dikenali") walau
    // baris lain di grup yang sama (qty > 0) punya vendor valid. Sekarang baris placeholder
    // ("-"/kosong) dilewati untuk keperluan resolusi vendor -- size-nya (qty 0) tetap tercatat,
    // cuma tidak dipakai untuk menentukan/memvalidasi vendorDefault grup.
    const vendorRaw = String(row["VENDOR"] ?? "").trim();
    const isVendorPlaceholder = vendorRaw === "" || vendorRaw === "-";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        id: "lg-" + groupMap.size,
        warna,
        lengan,
        sizes: [],
        totalQty: 0,
        ribKg: 0,
        kerahKg: 0,
        mansetKg: 0,
        rollEstimate: 0,
        // "" = belum ada baris ber-vendor valid ditemukan untuk grup ini sejauh ini -- diisi
        // begitu baris pertama yang BUKAN placeholder ditemukan (lihat di bawah), atau tetap ""
        // kalau grup ini memang tidak punya baris ber-vendor sama sekali (ditolak nanti kalau
        // ternyata totalQty > 0, lihat setelah loop).
        vendorDefault: "",
      });
    }
    const group = groupMap.get(key)!;
    group.sizes.push({ size, qty });
    if (!isVendorPlaceholder && !group.vendorDefault) {
      group.vendorDefault = normalizeVendorCode(vendorRaw);
    }
    const totalOverride = Number(row["TOTAL"] ?? 0);
    const ribOverride = Number(row["RIB KILOGRAM"] ?? 0);
    const rollOverride = Number(row["RAW MATERIAL (ROLL)"] ?? 0);
    if (totalOverride) group.totalQty = totalOverride;
    if (ribOverride) group.ribKg = ribOverride;
    if (rollOverride) group.rollEstimate = rollOverride;
    // Kerah/Manset (spec BAGIAN 2) -- HANYA dibaca untuk baris ber-KATEGORI persis "WANGKI MYNO"
    // (exact match setelah trim+uppercase, dikonfirmasi user) -- baris kategori lain SENGAJA tidak
    // menyentuh kerahKg/mansetKg grup ini sama sekali (tetap default 0). Sama pola override
    // "nilai non-zero terakhir menang" seperti ribOverride di atas, TANPA fallback formula.
    const rowKategori = String(row["KATEGORI"] ?? "").trim().toUpperCase();
    if (rowKategori === "WANGKI MYNO") {
      const kerahOverride = Number(row["KERAH"] ?? 0);
      const mansetOverride = Number(row["MANSET"] ?? 0);
      if (kerahOverride) group.kerahKg = kerahOverride;
      if (mansetOverride) group.mansetKg = mansetOverride;
    }
  }

  const lenganGroups = Array.from(groupMap.values()).map((g) => {
    if (!g.totalQty) g.totalQty = g.sizes.reduce((a, s) => a + s.qty, 0);
    if (!g.ribKg) g.ribKg = Math.round(((g.totalQty * 6.5) / 1000) * 1000) / 1000;
    if (!g.rollEstimate) g.rollEstimate = g.totalQty > 0 ? Math.max(1, Math.round(g.totalQty / 117)) : 0;
    // Grup dengan qty > 0 (benar-benar ada pemesanan) TAPI tidak satu pun barisnya punya vendor
    // valid (semuanya "-"/kosong) -- ini genuinely data tidak lengkap, bukan placeholder yang sah,
    // jadi tetap ditolak dengan pesan jelas (bukan diam-diam disimpan vendor kosong).
    if (g.totalQty > 0 && !g.vendorDefault) {
      throw new Error(`Kolom VENDOR untuk ${g.warna} · ${g.lengan} (qty ${g.totalQty}) kosong/"-" di semua barisnya — isi salah satu baris dengan kode/nama vendor yang valid.`);
    }
    return g;
  });
  // Item 2026-09-12 (user-reported, DIREVERT 2026-09-12): grup qty 0 (placeholder murni dari
  // template Excel -- warna/ukuran yang memang tidak dipesan di batch ini) dulu SENGAJA dibuang di
  // sini supaya tidak ada baris "kosong" yang ikut tersimpan sebagai lengan_groups/material_rows.
  // Sekarang grup qty 0 TETAP disimpan sebagai HISTORI MRP (tampil di PPIC & SCM "Riwayat
  // keputusan" dengan label "Tidak ada pemesanan", disembunyikan di SCM "Menunggu approval") --
  // tetap TIDAK PERNAH bocor ke Procurement karena rollEstimate/qtyRoll grup ini selalu 0, dan
  // semua filter downstream (materialGroupsByWarna, allMaterialAssigned,
  // countMaterialRowsWithoutSupplierForMrp) sudah berbasis `qtyRoll > 0`.

  const aduanRows: AduanPolaRow[] = [];
  if (aduanSheetName) {
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[aduanSheetName], { defval: null });
    if (rows.length > 0) {
      const aCols = Object.keys(rows[0]);
      const aMissing = ADUAN_COLUMNS.filter((c) => !aCols.includes(c));
      if (aMissing.length > 0) {
        throw new Error(`Sheet "${aduanSheetName}" tidak sesuai template — kolom hilang: ${aMissing.join(", ")}`);
      }
      rows.forEach((row, i) => {
        const warna = String(row["WARNA"] ?? "").trim();
        const lengan = toLengan(String(row["LENGAN"] ?? ""));
        const kode = String(row["ADUAN POLA"] ?? "").trim();
        const qtyRoll = Number(row["QTY ROLL"] ?? 0);
        const qty1 = Number(row["Qty1"] ?? 0);
        const qty2 = Number(row["Qty2"] ?? 0);
        if (!warna || !kode) return;
        const group = lenganGroups.find((g) => g.warna === warna && g.lengan === lengan);
        // Sejak 2026-09-12: grup qty 0 TIDAK LAGI dibuang dari lenganGroups (lihat catatan di atas
        // loop utama) -- guard ini sekarang PRAKTIS tidak akan pernah trigger untuk kasus itu lagi.
        // Tetap DIPERTAHANKAN sebagai proteksi FK: kalau sheet "Aduan Pola" mereferensikan
        // kombinasi warna+lengan yang memang sama sekali tidak ada di sheet MRP (harusnya tidak
        // terjadi secara bisnis -- tidak ada cutting nyata untuk kombinasi yang tidak disebut di
        // MRP sama sekali), jangan simpan dengan lenganGroupId kosong -- itu melanggar FK
        // aduan_pola_rows.lengan_group_id.
        if (!group) return;
        const parts = kode.split("-").map((s) => s.trim());
        let sizes: SizeQty[];
        if (parts.length === 2 && qty2) {
          if (parts[0] === parts[1]) sizes = [{ size: parts[0], qty: qty1 + qty2 }];
          else sizes = [{ size: parts[0], qty: qty1 }, { size: parts[1], qty: qty2 }];
        } else {
          sizes = [{ size: kode, qty: qty1 }];
        }
        aduanRows.push({
          id: "ad-" + i,
          lenganGroupId: group?.id ?? "",
          warna,
          lengan,
          kode,
          qtyRoll,
          sizes,
          qty: sizes.reduce((a, s) => a + s.qty, 0),
          // `|| "-"` (bukan `??`) -- vendorDefault bisa jadi string kosong "" (grup qty 0 tanpa
          // vendor valid sama sekali, lihat catatan di atas), bukan cuma null/undefined.
          vendor: group?.vendorDefault || "-",
        });
      });
    }
  }

  const materialRows: MaterialRow[] = lenganGroups.map((g) => ({
    id: "mat-" + g.id,
    lenganGroupId: g.id,
    warna: g.warna,
    lengan: g.lengan,
    qtyRoll: g.rollEstimate,
    ribKg: g.ribKg,
    kerahKg: g.kerahKg,
    mansetKg: g.mansetKg,
    supplier: null,
  }));

  const kategori = String(mrpRows[0]["KATEGORI"] ?? "-").trim();
  const warna = lenganGroups[0]?.warna ?? "-";
  const qty = lenganGroups.reduce((a, g) => a + g.totalQty, 0);

  return { kategori, warna, qty, isFob, lenganGroups, aduanRows, materialRows };
}
