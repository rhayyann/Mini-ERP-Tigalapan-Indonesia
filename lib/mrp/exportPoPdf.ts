import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatRupiah, formatDate, formatDecimal, formatPcs, localDateString, hargaKainRate, hargaMaklonRate, mrpDetailFor } from "./derive";
import { VENDOR_PRODUKSI } from "./seed";
import type { MrpDetail } from "./store";
import type { HargaKainPksRow, HargaKainRow, HargaMaklonRow } from "./masterData";
import type { Lengan, MaklonPO, MaterialPO } from "./types";

// Format PDF ini SENGAJA meniru tata letak PO dari ERP lama user (logo+subjudul di kiri atas,
// judul dokumen di tengah, info wajib dalam kotak 2 kolom, tabel rincian ber-header hijau
// dengan subtotal, garis TOTAL besar, lalu kotak tanda tangan 2 kolom di bagian bawah) — supaya
// dokumen yang di-download dari sini terasa konsisten dengan dokumen lama yang sudah dikenal tim.
const PAGE_W = 595.28;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CENTER_X = PAGE_W / 2;
const TEAL: [number, number, number] = [13, 148, 136];
const GRAY_LABEL: [number, number, number] = [130, 130, 140];
const GRAY_BORDER: [number, number, number] = [225, 225, 230];
const INK: [number, number, number] = [26, 26, 31];

function drawHeader(doc: jsPDF, title: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text("TIGALAPAN KAOS", MARGIN, 42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY_LABEL);
  doc.text("PT Tigalapan Sukses Indo · Sistem ERP Terintegrasi · Modul Procurement", MARGIN, 55);

  doc.setDrawColor(...GRAY_BORDER);
  doc.line(MARGIN, 65, PAGE_W - MARGIN, 65);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(title, CENTER_X, 92, { align: "center" });

  return 116;
}

// Tabel info 2-kolom (label tebal | value normal) bersambung dengan garis internal — BUKAN kotak
// terpisah label-di-atas-value-di-bawah seperti versi sebelumnya. Ini meniru persis dokumen lama
// user: 1 blok kiri + 1 blok kanan, tiap blok 2 kolom (label ~38% lebar, value sisanya), 4 baris,
// garis horizontal antar baris & garis vertikal antara label/value, label DAN value sama-sama
// warna gelap (label tebal, value normal) — bukan label abu-abu redup.
function drawInfoGrid(doc: jsPDF, startY: number, left: [string, string][], right: [string, string][]): number {
  const halfW = (CONTENT_W - 16) / 2;
  const rows = Math.max(left.length, right.length);
  drawInfoBlock(doc, MARGIN, startY, halfW, left);
  drawInfoBlock(doc, MARGIN + halfW + 16, startY, halfW, right);
  return startY + rows * 34 + 20;
}

function drawInfoBlock(doc: jsPDF, x: number, y: number, w: number, fields: [string, string][]) {
  const rowH = 34;
  const labelW = w * 0.4;
  const h = fields.length * rowH;

  doc.setDrawColor(...GRAY_BORDER);
  doc.rect(x, y, w, h);
  doc.line(x + labelW, y, x + labelW, y + h);
  for (let i = 1; i < fields.length; i++) doc.line(x, y + i * rowH, x + w, y + i * rowH);

  fields.forEach(([label, value], i) => {
    const rowY = y + i * rowH;
    const textY = rowY + rowH / 2 + 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(label, x + 10, textY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(value || "—", x + labelW + 10, textY);
  });
}

function drawSectionHeading(doc: jsPDF, y: number, text: string): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(text, MARGIN, y);
  return y + 12;
}

function lastAutoTableY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function drawSubtotal(doc: jsPDF, y: number, label: string, amount: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(`${label}: ${formatRupiah(amount)}`, PAGE_W - MARGIN, y, { align: "right" });
  return y + 22;
}

function drawGrandTotal(doc: jsPDF, y: number, label: string, amount: number): number {
  doc.setDrawColor(...INK);
  doc.line(MARGIN + CONTENT_W / 2, y, PAGE_W - MARGIN, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(`${label}: ${formatRupiah(amount)}`, PAGE_W - MARGIN, y + 20, { align: "right" });
  return y + 44;
}

function drawSignatureBoxes(doc: jsPDF, y: number, leftLabel: string, leftName: string, rightLabel: string, rightName: string) {
  const boxW = (CONTENT_W - 16) / 2;
  const boxH = 66;
  doc.setDrawColor(...GRAY_BORDER);
  doc.rect(MARGIN, y, boxW, boxH);
  doc.rect(MARGIN + boxW + 16, y, boxW, boxH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY_LABEL);
  doc.text(leftLabel, MARGIN + 10, y + 16);
  doc.text(rightLabel, MARGIN + boxW + 26, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(leftName, MARGIN + 10, y + 48);
  doc.text(rightName, MARGIN + boxW + 26, y + 48);
}

function footerY(doc: jsPDF): number {
  const pageH = doc.internal.pageSize.getHeight();
  return pageH - 40 - 66; // ruang tanda tangan selalu di bagian bawah halaman
}

/** Generate & download PDF Purchase Order — Bahan Baku (Material), format meniru dokumen PO
 *  lama user: header brand, kotak info 2 kolom, 1 tabel rincian per warna dengan header hijau,
 *  subtotal + total, kotak tanda tangan Procurement/Finance. */
export function exportMaterialPoPdf(po: MaterialPO, mrpDetails: MrpDetail[], hargaKain: HargaKainRow[], hargaKainPks: HargaKainPksRow[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const vendorName = VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi;
  const kategori = mrpDetailFor(po.mrpId, mrpDetails)?.mrp.kategori ?? "—";

  let y = drawHeader(doc, "PURCHASE ORDER - BAHAN BAKU");

  y = drawInfoGrid(
    doc,
    y,
    [
      ["No. PO", po.id],
      ["No. MRP", po.mrpId],
      ["Tanggal Cetak", formatDate(localDateString(new Date()))],
      ["Status", po.approved ? "Disetujui" : "Menunggu Persetujuan"],
    ],
    [
      ["Vendor Produksi", vendorName],
      ["Entitas", po.approved ? po.entity : "Menunggu input Finance"],
      ["Jumlah Warna", `${po.colorBreakdown.length} warna`],
      ["Total Biaya Bahan", formatRupiah(po.amount)],
    ]
  );

  y = drawSectionHeading(doc, y, `1. ${po.id} — ${po.supplier}`);

  // Rate per kg dicari SEKALI per warna (tonase dikumulasi lintas lengan warna yang sama dalam PO
  // ini), lalu dipakai untuk semua baris warna itu — sama seperti materialAmountForPo di derive.ts.
  const kgByWarna = new Map<string, number>();
  for (const c of po.colorBreakdown) kgByWarna.set(c.warna, (kgByWarna.get(c.warna) ?? 0) + c.rollCount * 25);
  const rateByWarna = new Map<string, number>();
  for (const [warna, kg] of kgByWarna) rateByWarna.set(warna, hargaKainRate(hargaKain, hargaKainPks, po.supplier, warna, kg));

  const rows = po.colorBreakdown.map((c, i) => {
    const kg = c.rollCount * 25;
    const rate = rateByWarna.get(c.warna) ?? 0;
    return [String(i + 1), kategori, c.lengan ? `${c.warna} · ${c.lengan}` : c.warna, formatDecimal(c.rollCount, 1), formatDecimal(kg, 1), formatRupiah(rate), formatRupiah(kg * rate)];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["No", "Kategori", "Warna", "Roll", "Kg", "Harga/Kg", "Biaya"]],
    body: rows,
    styles: { fontSize: 8.5, textColor: INK, lineColor: GRAY_BORDER },
    headStyles: { fillColor: TEAL, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 24 },
      3: { halign: "right", cellWidth: 45 },
      4: { halign: "right", cellWidth: 50 },
      5: { halign: "right", cellWidth: 75 },
      6: { halign: "right", cellWidth: 85 },
    },
  });

  y = lastAutoTableY(doc) + 14;
  y = drawSubtotal(doc, y, `Subtotal ${po.id}`, po.amount);
  y = drawGrandTotal(doc, y, "TOTAL BIAYA BAHAN", po.amount);

  drawSignatureBoxes(doc, Math.max(y, footerY(doc)), "DIAJUKAN OLEH (PROCUREMENT)", "Tim Procurement", "DISETUJUI OLEH (FINANCE)", po.approved ? "Disetujui" : "Menunggu tanda tangan");

  doc.save(`PO-${po.id}.pdf`);
}

/** Generate & download PDF Purchase Order — Maklon Vendor, format sama dengan Bahan Baku tapi
 *  rincian per warna menampilkan Qty PDK/PJG (bukan roll/kg) — dihitung dari aduanRows MRP
 *  terkait untuk vendor ini, bukan langsung dari MaklonPO (yang cuma simpan total qty & amount). */
export function exportMaklonPoPdf(po: MaklonPO, mrpDetails: MrpDetail[], hargaMaklon: HargaMaklonRow[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const vendorName = VENDOR_PRODUKSI[po.vendorProduksi]?.name ?? po.vendorProduksi;
  const detail = mrpDetailFor(po.mrpId, mrpDetails);
  const kategori = detail?.mrp.kategori ?? "—";
  const aduanRows = detail?.aduanRows.filter((a) => a.vendor === po.vendorProduksi) ?? [];

  let y = drawHeader(doc, "PURCHASE ORDER - MAKLON VENDOR");

  y = drawInfoGrid(
    doc,
    y,
    [
      ["No. PO", po.id],
      ["No. MRP", po.mrpId],
      ["Tanggal Cetak", formatDate(localDateString(new Date()))],
      ["Status", po.approved ? "Disetujui" : "Menunggu Persetujuan"],
    ],
    [
      ["Vendor Produksi", vendorName],
      ["Total Qty", `${formatPcs(po.qty)} pcs`],
      ["Kategori", kategori],
      ["Total Biaya Maklon", formatRupiah(po.amount)],
    ]
  );

  y = drawSectionHeading(doc, y, `1. ${vendorName}`);

  // Rate per lengan dicari dari kumulatif qty LINTAS WARNA untuk lengan itu di PO ini (sama
  // seperti maklonAmountForLenganBuckets di derive.ts), lalu dipakai buat semua baris warna.
  const cumByLengan = new Map<Lengan, number>();
  for (const a of aduanRows) cumByLengan.set(a.lengan, (cumByLengan.get(a.lengan) ?? 0) + a.qty);
  const rateByLengan = new Map<Lengan, number>();
  for (const [lengan, qty] of cumByLengan) rateByLengan.set(lengan, hargaMaklonRate(hargaMaklon, po.vendorProduksi, lengan, qty));

  const byWarna = new Map<string, { warna: string; pdk: number; pjg: number }>();
  for (const a of aduanRows) {
    const cur = byWarna.get(a.warna) ?? { warna: a.warna, pdk: 0, pjg: 0 };
    if (a.lengan === "PENDEK") cur.pdk += a.qty;
    else cur.pjg += a.qty;
    byWarna.set(a.warna, cur);
  }

  const warnaRows = Array.from(byWarna.values());
  const rows = warnaRows.map((r, i) => {
    const biaya = Math.round(r.pdk * (rateByLengan.get("PENDEK") ?? 0) + r.pjg * (rateByLengan.get("PANJANG") ?? 0));
    return [String(i + 1), kategori, r.warna, r.pdk ? formatPcs(r.pdk) : "—", r.pjg ? formatPcs(r.pjg) : "—", po.mrpId, formatRupiah(biaya)];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["No", "Kategori", "Warna", "Qty PDK", "Qty PJG", "No. MRP", "Biaya"]],
    body: rows.length > 0 ? rows : [["—", kategori, "—", "—", "—", po.mrpId, formatRupiah(po.amount)]],
    styles: { fontSize: 8.5, textColor: INK, lineColor: GRAY_BORDER },
    headStyles: { fillColor: TEAL, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 24 },
      3: { halign: "right", cellWidth: 55 },
      4: { halign: "right", cellWidth: 55 },
      5: { cellWidth: 70 },
      6: { halign: "right", cellWidth: 85 },
    },
  });

  y = lastAutoTableY(doc) + 14;
  y = drawSubtotal(doc, y, `Subtotal ${vendorName}`, po.amount);
  y = drawGrandTotal(doc, y, "TOTAL BIAYA MAKLON", po.amount);

  drawSignatureBoxes(doc, Math.max(y, footerY(doc)), "DIAJUKAN OLEH (PROCUREMENT)", "Tim Procurement", "DISETUJUI OLEH (FINANCE)", po.approved ? "Disetujui" : "Menunggu tanda tangan");

  doc.save(`PO-${po.id}.pdf`);
}
