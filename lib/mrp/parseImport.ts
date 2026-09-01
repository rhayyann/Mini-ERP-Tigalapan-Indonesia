import * as XLSX from "xlsx";
import type { AduanPolaRow, Lengan, LenganGroup, MaterialRow, SizeQty } from "./types";
import { VENDOR_PRODUKSI } from "./seed";

/** Cocokkan kode vendor dari Excel (bebas huruf besar/kecil, spasi, atau tanpa strip — mis.
 *  "bayu", "gi01") ke kode vendor resmi (mis. "BAYU", "GI-01"). Kalau tidak ada yang cocok,
 *  lempar error jelas — supaya PO/invoice tidak pernah "hilang" karena kode vendor typo yang
 *  diam-diam disimpan apa adanya (mis. "BY") dan tidak pernah cocok dengan vendor manapun. */
function normalizeVendorCode(raw: string): string {
  const cleaned = raw.trim();
  const key = cleaned.toUpperCase().replace(/[\s-]/g, "");
  const match = Object.keys(VENDOR_PRODUKSI).find((k) => k.toUpperCase().replace(/[\s-]/g, "") === key);
  if (!match) {
    const valid = Object.keys(VENDOR_PRODUKSI).join(", ");
    throw new Error(`Kode vendor "${cleaned}" pada kolom VENDOR tidak dikenali. Kode vendor yang valid: ${valid}.`);
  }
  return match;
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
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        id: "lg-" + groupMap.size,
        warna,
        lengan,
        sizes: [],
        totalQty: 0,
        ribKg: 0,
        rollEstimate: 0,
        vendorDefault: normalizeVendorCode(String(row["VENDOR"] ?? "")),
      });
    }
    const group = groupMap.get(key)!;
    group.sizes.push({ size, qty });
    const totalOverride = Number(row["TOTAL"] ?? 0);
    const ribOverride = Number(row["RIB KILOGRAM"] ?? 0);
    const rollOverride = Number(row["RAW MATERIAL (ROLL)"] ?? 0);
    if (totalOverride) group.totalQty = totalOverride;
    if (ribOverride) group.ribKg = ribOverride;
    if (rollOverride) group.rollEstimate = rollOverride;
  }

  const lenganGroups = Array.from(groupMap.values()).map((g) => {
    if (!g.totalQty) g.totalQty = g.sizes.reduce((a, s) => a + s.qty, 0);
    if (!g.ribKg) g.ribKg = Math.round(((g.totalQty * 6.5) / 1000) * 1000) / 1000;
    if (!g.rollEstimate) g.rollEstimate = Math.max(1, Math.round(g.totalQty / 117));
    return g;
  });

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
          vendor: group?.vendorDefault ?? "-",
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
    supplier: null,
  }));

  const kategori = String(mrpRows[0]["KATEGORI"] ?? "-").trim();
  const warna = lenganGroups[0]?.warna ?? "-";
  const qty = lenganGroups.reduce((a, g) => a + g.totalQty, 0);

  return { kategori, warna, qty, isFob, lenganGroups, aduanRows, materialRows };
}
