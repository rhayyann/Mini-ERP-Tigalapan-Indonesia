export type Gate = {
  id: number;
  name: string;
  phase: number;
  role: string;
  sla: number;
  desc: string;
  action: string;
  done: string;
  reject?: boolean;
  alt?: string;
};

export const GATES: Gate[] = [
  { id: 1, name: "PPIC Input", phase: 0, role: "PPIC", sla: 1, desc: "Input jumlah roll, aduan pola, dan vendor maklon tujuan.", action: "Submit PR", done: "PR-2026-084 disubmit ke Procurement" },
  { id: 2, name: "Vendor Selection", phase: 1, role: "Procurement", sla: 2, desc: "Pilih supplier & maklon, set harga per roll dan diskon.", action: "Kirim PO ke Finance", done: "PO Supplier & PO Maklon draft dibuat" },
  { id: 3, name: "PO Approval", phase: 1, role: "Finance", sla: 1, desc: "Verifikasi entitas pembeli, budget, lalu approve PO.", action: "Approve PO", reject: true, done: "PO-SUP-001 & PO-MKL-001 approved" },
  { id: 4, name: "Invoice Supplier", phase: 2, role: "Procurement", sla: 3, desc: "Catat invoice per roll: berat kotor, berat bersih, harga, diskon.", action: "Catat invoice", done: "INV-234 dicatat · Rp 14.775.000" },
  { id: 5, name: "Monitoring Material", phase: 2, role: "Procurement", sla: 2, desc: "Pantau kedatangan bahan; roll yang tidak siap bisa di-close partial.", action: "Tandai bahan lengkap", alt: "Close 2 roll (partial)", done: "20 roll dinyatakan lengkap" },
  { id: 6, name: "Payment Supplier", phase: 2, role: "Finance", sla: 30, desc: "Buat paying voucher dan eksekusi pembayaran invoice supplier.", action: "Bayar (buat PV)", done: "PV-094 dibayar · status material PAID" },
  { id: 7, name: "Receiving Maklon", phase: 2, role: "Vendor Maklon", sla: 1, desc: "Timbang roll, hitung selisih berat vs toleransi vendor (5–8%).", action: "Accept bahan", alt: "Ajukan claim (RMA)", done: "Bahan diterima · READY FOR PRODUCTION" },
  { id: 8, name: "Production Setup", phase: 3, role: "Vendor Maklon", sla: 2, desc: "Pilih aduan pola dan roll yang digabung dalam satu production line.", action: "Buat production batch", done: "Batch PROD-001-A-001 dibuat · 300 pcs" },
  { id: 9, name: "Cutting", phase: 3, role: "Vendor Maklon", sla: 3, desc: "Input kode setting, gramasi, jam resting/cutting, dan qty hasil.", action: "Selesaikan cutting", done: "Cutting 295 pcs · variance −5 (cacat bahan)" },
  { id: 10, name: "Finish Good & QC", phase: 3, role: "QC Maklon", sla: 2, desc: "Submit FG bertahap sampai qty cutting; sisanya jadi reject.", action: "Tutup FG (complete)", done: "FG 293 pcs · reject 2 pcs · yield 99,3%" },
  { id: 11, name: "Packaging & Delivery", phase: 4, role: "Logistics", sla: 2, desc: "Input koli (warna, FG/NG, berat) dan pilih ekspedisi.", action: "Kirim barang", done: "DEL-001 · 4 koli · JNE Express" },
  { id: 12, name: "Invoice Maklon", phase: 5, role: "Vendor Maklon", sla: 5, desc: "Submit invoice maklon beserta yield report per aduan pola.", action: "Submit invoice", done: "MKL-001 disubmit · subtotal Rp 8.450.000" },
  { id: 13, name: "Review & Payment", phase: 5, role: "Finance", sla: 2, desc: "Approve invoice, buat PV, tahan retention 10%, tutup PO.", action: "Bayar & tutup PO", reject: true, done: "PV-098 dibayar Rp 7.605.000 · retention held" },
];

export const PHASES = ["Planning", "PO & Approval", "Material", "Produksi", "Delivery", "Invoice & Payment"];
