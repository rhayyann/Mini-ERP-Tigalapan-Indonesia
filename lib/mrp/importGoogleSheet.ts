import * as XLSX from "xlsx";
import type { EntitasRow, HargaKainPksRow, HargaKainRow, HargaMaklonRow } from "./masterData";

/** Import master data dari Google Sheets "publish to web" (link CSV publik) — dijalankan
 *  langsung dari browser (fetch), tidak butuh backend. SATU ARAH: cuma baca dari Sheets, tidak
 *  pernah menulis balik ke sana (secara teknis tidak mungkin tanpa Google Sheets API + backend).
 *  Setelah import, data yang tersimpan di store inilah yang jadi sumber kebenaran — edit
 *  selanjutnya dilakukan di halaman Master Data, bukan di spreadsheet lagi. */

export async function fetchGoogleSheetCsv(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Gagal mengambil data — periksa koneksi internet Anda.");
  }
  if (!res.ok) {
    throw new Error(`Gagal mengambil data dari Google Sheets (HTTP ${res.status}). Pastikan link "publish to web" masih aktif.`);
  }
  const text = await res.text();
  if (!text.trim()) throw new Error("Data dari Google Sheets kosong.");
  return text;
}

/** Reuse library `xlsx` (SheetJS) yang sudah dipakai lib/mrp/parseImport.ts untuk import file
 *  Excel — di sini dipakai untuk parse teks CSV (`{type:"string"}`, beda dari parseImport.ts yang
 *  parse ArrayBuffer file upload). Menghindari nambah dependency CSV parser baru. */
export function parseCsvRows(csvText: string): Record<string, unknown>[] {
  const wb = XLSX.read(csvText, { type: "string" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
}

/** "Rp3.136" / "Rp 4.700" -> 3136 / 4700. Juga tetap terima angka polos seperti "118000". */
export function parseIndoRupiah(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const digits = s.replace(/Rp/gi, "").replace(/[.\s]/g, "").trim();
  const n = parseInt(digits, 10);
  return isNaN(n) ? 0 : n;
}

function numOrUndefined(raw: unknown): number | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

function requireColumns(rows: Record<string, unknown>[], columns: string[]) {
  if (rows.length === 0) throw new Error("Sheet kosong — tidak ada baris data.");
  const present = Object.keys(rows[0]);
  const missing = columns.filter((c) => !present.includes(c));
  if (missing.length > 0) throw new Error(`Kolom wajib hilang di sheet: ${missing.join(", ")}. Cek header sheet-nya.`);
}

const HARGA_MAKLON_COLUMNS = ["KODE VENDOR", "NAMA VENDOR", "TIPE LENGAN", "JENIS HARGA", "KAPASITAS MIN", "KAPASITAS MAX", "HARGA"];

export function mapHargaMaklonRows(rows: Record<string, unknown>[]): HargaMaklonRow[] {
  requireColumns(rows, HARGA_MAKLON_COLUMNS);
  return rows
    .filter((r) => String(r["KODE VENDOR"] ?? "").trim())
    .map((r, i) => ({
      id: "HMKL-import-" + i,
      kodeVendor: String(r["KODE VENDOR"] ?? "").trim(),
      namaVendor: String(r["NAMA VENDOR"] ?? "").trim(),
      tipeLengan: String(r["TIPE LENGAN"] ?? "").trim(),
      jenisHarga: String(r["JENIS HARGA"] ?? "").trim() === "PKS" ? "PKS" : "Standar",
      kapasitasMin: numOrUndefined(r["KAPASITAS MIN"]),
      kapasitasMax: numOrUndefined(r["KAPASITAS MAX"]),
      harga: parseIndoRupiah(r["HARGA"]),
    }));
}

const HARGA_KAIN_COLUMNS = ["KODE SUPPLIER", "NAMA SUPPLIER", "KATEGORI", "WARNA", "HARGA PER KG"];

export function mapHargaKainRows(rows: Record<string, unknown>[]): HargaKainRow[] {
  requireColumns(rows, HARGA_KAIN_COLUMNS);
  return rows
    .filter((r) => String(r["KODE SUPPLIER"] ?? "").trim())
    .map((r, i) => ({
      id: "HKAIN-import-" + i,
      kodeSupplier: String(r["KODE SUPPLIER"] ?? "").trim(),
      namaSupplier: String(r["NAMA SUPPLIER"] ?? "").trim(),
      kategori: String(r["KATEGORI"] ?? "").trim(),
      warna: String(r["WARNA"] ?? "").trim(),
      hargaPerKg: parseIndoRupiah(r["HARGA PER KG"]),
    }));
}

const HARGA_KAIN_PKS_COLUMNS = ["KODE SUPPLIER", "KATEGORI", "WARNA", "SATUAN", "TONASE MIN", "TONASE MAX", "HARGA PER KG"];

export function mapHargaKainPksRows(rows: Record<string, unknown>[]): HargaKainPksRow[] {
  requireColumns(rows, HARGA_KAIN_PKS_COLUMNS);
  return rows
    .filter((r) => String(r["KODE SUPPLIER"] ?? "").trim())
    .map((r, i) => ({
      id: "HKPKS-import-" + i,
      kodeSupplier: String(r["KODE SUPPLIER"] ?? "").trim(),
      kategori: String(r["KATEGORI"] ?? "").trim(),
      warna: String(r["WARNA"] ?? "").trim(),
      satuan: String(r["SATUAN"] ?? "").trim(),
      tonaseMin: numOrUndefined(r["TONASE MIN"]),
      tonaseMax: numOrUndefined(r["TONASE MAX"]),
      hargaPerKg: parseIndoRupiah(r["HARGA PER KG"]),
    }));
}

const ENTITAS_COLUMNS = ["NAMA ENTITAS"];

export function mapEntitasRows(rows: Record<string, unknown>[]): EntitasRow[] {
  requireColumns(rows, ENTITAS_COLUMNS);
  return rows
    .filter((r) => String(r["NAMA ENTITAS"] ?? "").trim())
    .map((r, i) => ({ id: "ENT-import-" + i, nama: String(r["NAMA ENTITAS"] ?? "").trim() }));
}

/** Link publish-to-web (hardcode, bukan input user) untuk tiap dataset — sesuai yang diberikan
 *  user (sheet yang sama, gid berbeda per tab). */
export const GOOGLE_SHEET_URLS = {
  hargaMaklon:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSsiwzxBXdvMT2bTO9Z3G8ugcn6ult4Hyyl_Xk1pyANXNjKIiY7RTWpMtJcxLkAT1gOME5SF7Jz-93S/pub?gid=166505911&single=true&output=csv",
  hargaKain:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSsiwzxBXdvMT2bTO9Z3G8ugcn6ult4Hyyl_Xk1pyANXNjKIiY7RTWpMtJcxLkAT1gOME5SF7Jz-93S/pub?gid=892364186&single=true&output=csv",
  hargaKainPks:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSsiwzxBXdvMT2bTO9Z3G8ugcn6ult4Hyyl_Xk1pyANXNjKIiY7RTWpMtJcxLkAT1gOME5SF7Jz-93S/pub?gid=896830290&single=true&output=csv",
  entitas:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vSsiwzxBXdvMT2bTO9Z3G8ugcn6ult4Hyyl_Xk1pyANXNjKIiY7RTWpMtJcxLkAT1gOME5SF7Jz-93S/pub?gid=2066649444&single=true&output=csv",
} as const;
