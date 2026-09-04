"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import { formatRupiah, invoiceBadge } from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { RawMaterialInvoice } from "@/lib/mrp/types";
// Item 2.7: getInvoicePaymentProofAction DIPANGGIL LANGSUNG dari komponen ini (bukan lewat store)
// -- sama pola dengan getMaterialClaimPhotoAction (material-claims/page.tsx), payload PDF-nya
// sengaja dikeluarkan dari snapshot (migration 0017), jadi cuma fetch on-demand saat user klik
// "Lihat bukti".
import { getInvoicePaymentProofAction } from "@/lib/mrp/actions";

// Round-2 fix (Tester bug 2): batas HARUS dicek pada ukuran hasil ENCODE base64, bukan
// `file.size` mentah -- base64 menggembungkan ukuran kira-kira +33%, jadi file 1.5 MB mentah jadi
// sekitar 2.05 MB ter-encode, nyaris SAMA/LEBIH BESAR dari body limit Server Action 2 MB
// (next.config.ts) dan tidak menyisakan margin buat prefix data URI, fileName, array invoiceIds,
// serta overhead JSON/RSC lain.
//
// Round-3 fix (Reviewer should-fix #1): iterasi Round-2 sebelumnya salah hitung -- fungsinya
// (disalin dari `dataUrlApproxBytes` di production-cutting-tab.tsx) itu MEMBALIK inflasi base64
// (`b64.length * 0.75`), jadi hasilnya estimasi ukuran file MENTAH sebelum encode, BUKAN ukuran
// hasil-encode yang sebenarnya dikirim lewat body Server Action. Akibatnya batas
// `MAX_PROOF_ENCODED_BYTES` yang namanya "encoded" itu sebenarnya cuma membatasi file mentah ke
// ~1.4 MB, yang ukuran ter-encode aslinya ~1.87 MB -- margin nyata di bawah limit 2 MB cuma
// ~136 KB, bukan ~614 KB yang dikira sebelumnya (aman untuk sekarang, tapi kalau angka
// MAX_PROOF_ENCODED_BYTES ini dinaikkan lagi nanti berdasar komentar yang salah, bug boundary yang
// sama seperti Round-1 bisa muncul lagi tanpa disadari). Sekarang dibetulkan: `dataUrlEncodedBytes`
// mengukur PANJANG STRING BASE64 APA ADANYA (1 karakter base64 = 1 byte ASCII di payload yang
// benar2 dikirim), tanpa pembagian 0.75 apa pun, lalu dibandingkan LANGSUNG ke batas ter-encode.
function dataUrlEncodedBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return b64.length;
}
const MAX_PROOF_ENCODED_BYTES = 1.5 * 1024 * 1024; // batas ASLI hasil-encode -- margin ~500 KB di bawah limit 2 MB body Server Action

async function viewPaymentProof(invoiceId: string) {
  const proof = await getInvoicePaymentProofAction(invoiceId);
  if (!proof) return;
  window.open(proof.dataUrl, "_blank");
}

/** Panel "Payment" (material) — konten diekstrak dari halaman lama /finance/payment,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/payment. */
export function PaymentPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const setInvoicesPaid = useMrpStore((s) => s.setInvoicesPaid);
  const setInvoicePaymentProof = useMrpStore((s) => s.setInvoicePaymentProof);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bukti pembayaran opsional yang dipilih SEBELUM klik "Bayar" — dipasangkan ke semua invoice
  // yang dibayar di klik itu (item 2.7).
  const [proofDataUrl, setProofDataUrl] = useState<string | undefined>(undefined);
  const [proofFileName, setProofFileName] = useState<string | undefined>(undefined);
  const [proofError, setProofError] = useState("");
  // Upload/ganti bukti INLINE per-baris (setelah invoice sudah PAID) — null = tidak ada baris yang
  // sedang membuka file picker-nya.
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [rowProofError, setRowProofError] = useState("");

  if (!mounted) return null;

  const selectedList = invoices.filter((i) => selected.has(i.id));
  const selectableToPay = selectedList.filter((i) => i.status === "INVOICED");
  const selectableToUnpay = selectedList.filter((i) => i.status === "PAID");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Validasi sama seperti handleBuktiPvChange di paying-voucher-wizard.tsx (PDF only). Batas
  // ukuran dicek SETELAH readAsDataURL selesai, terhadap ukuran ENCODED (lihat komentar
  // MAX_PROOF_ENCODED_BYTES di atas) -- bukan `file.size` mentah sebelum encode, yang tidak
  // menyisakan margin cukup di bawah body limit Server Action 2 MB.
  function handleProofFileChange(file: File | null) {
    setProofError("");
    if (!file) {
      setProofDataUrl(undefined);
      setProofFileName(undefined);
      return;
    }
    if (file.type !== "application/pdf") {
      setProofError("File harus berformat PDF.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrlEncodedBytes(dataUrl) > MAX_PROOF_ENCODED_BYTES) {
        setProofError("File terlalu besar — kompres dulu PDF-nya.");
        setProofDataUrl(undefined);
        setProofFileName(undefined);
        return;
      }
      setProofDataUrl(dataUrl);
      setProofFileName(file.name);
    };
    reader.onerror = () => setProofError("Gagal membaca file, coba lagi.");
    reader.readAsDataURL(file);
  }

  async function handlePay() {
    const ids = selectableToPay.map((i) => i.id);
    await setInvoicesPaid(ids, true);
    // Bukti TIDAK PERNAH wajib untuk membayar -- kalau dipilih, dipasangkan ke semua invoice yang
    // baru dibayar di klik ini sekaligus (1 file bank transfer bisa melunasi beberapa invoice).
    if (proofDataUrl) await setInvoicePaymentProof(ids, proofDataUrl, proofFileName);
    setSelected(new Set());
    setProofDataUrl(undefined);
    setProofFileName(undefined);
    setProofError("");
  }

  // Round-3 fix (Reviewer should-fix #2): "Ganti"/"Upload" dulu langsung setUploadingFor(i.id)
  // tanpa membersihkan rowProofError -- kalau baris A sempat error (mis. pilih file bukan-PDF)
  // lalu user pindah ke "Ganti"/"Upload" baris B TANPA klik "Batal" dulu, pesan error baris A
  // masih nempel tampil di baris B padahal belum ada file apapun yang dipilih untuk B. rowProofError
  // sengaja tetap satu state global (bukan di-key per invoice) karena cuma satu baris yang bisa
  // dalam mode upload sekaligus (uploadingFor cuma satu id) -- jadi cukup dibersihkan di SETIAP
  // titik masuk mode upload, bukan cuma di "Batal".
  function openRowUpload(invoiceId: string) {
    setRowProofError("");
    setUploadingFor(invoiceId);
  }

  function handleRowProofFileChange(invoiceId: string, file: File | null) {
    setRowProofError("");
    if (!file) return;
    if (file.type !== "application/pdf") {
      setRowProofError("File harus berformat PDF.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (dataUrlEncodedBytes(dataUrl) > MAX_PROOF_ENCODED_BYTES) {
        setRowProofError("File terlalu besar — kompres dulu PDF-nya.");
        return;
      }
      await setInvoicePaymentProof([invoiceId], dataUrl, file.name);
      setUploadingFor(null);
    };
    reader.onerror = () => setRowProofError("Gagal membaca file, coba lagi.");
    reader.readAsDataURL(file);
  }

  // 8 kolom default (+ checkbox di firstColumn) — No Invoice Supplier & Entitas tetap ada, cuma
  // dipindah ke toggle "Kolom" (lebih ke arah detail rekonsiliasi/akuntansi daripada info inti
  // buat memutuskan bayar/tidak). Urutan: No MRP, No PO, Kode Transaksi, lalu sisanya.
  const columns: ColumnDef<RawMaterialInvoice>[] = [
    { key: "noMrp", label: "No MRP", default: true, render: (i) => <span className="font-mono">{i.mrpId}</span> },
    { key: "noPo", label: "No PO", default: true, render: (i) => <span className="font-mono font-medium">{i.poId}</span> },
    { key: "kodeTransaksi", label: "Kode Transaksi", default: true, render: (i) => <span className="font-mono font-medium">{i.kodeTransaksi}</span> },
    { key: "supplier", label: "Supplier / Vendor", default: true, render: (i) => `${i.supplier} → ${VENDOR_PRODUKSI[i.destinationVendor]?.name ?? i.destinationVendor}` },
    { key: "noInvVendor", label: "No Invoice Supplier", default: false, render: (i) => i.noInvoiceVendor || "—" },
    // default:false — dipindah ke toggle "Kolom" (detail rekonsiliasi, bukan info inti buat
    // memutuskan bayar/tidak); nilai & status tetap jadi info inti.
    { key: "roll", label: "Roll", default: false, align: "right", render: (i) => i.qtyReady },
    { key: "nilai", label: "Nilai", default: true, align: "right", render: (i) => formatRupiah(i.totalBiaya) },
    { key: "entitas", label: "Entitas", default: false, render: (i) => i.entity },
    { key: "status", label: "Status", default: true, render: (i) => <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill> },
    {
      key: "bukti",
      label: "Lampiran Invoice",
      default: true,
      render: (i) =>
        i.buktiPvDataUrl ? (
          <button onClick={() => window.open(i.buktiPvDataUrl, "_blank")} className="font-sans text-[11px] font-semibold text-action-primary underline">
            Lihat bukti
          </button>
        ) : (
          <span className="font-sans text-[11px] text-text-muted">—</span>
        ),
    },
    {
      key: "buktiBayar",
      label: "Bukti Pembayaran",
      default: true,
      render: (i) => {
        if (uploadingFor === i.id) {
          return (
            <div className="flex flex-col items-start gap-1">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => handleRowProofFileChange(i.id, e.target.files?.[0] ?? null)}
                className="w-40 text-[10.5px] file:mr-1.5 file:rounded file:border-0 file:bg-info-bg file:px-2 file:py-0.5 file:font-sans file:text-[10.5px] file:font-semibold file:text-info-fg"
              />
              {rowProofError && <span className="font-sans text-[10.5px] text-danger-fg">{rowProofError}</span>}
              <button onClick={() => { setUploadingFor(null); setRowProofError(""); }} className="font-sans text-[10.5px] text-text-muted underline">
                Batal
              </button>
            </div>
          );
        }
        if (i.buktiBayarAt) {
          return (
            <div className="flex items-center gap-2">
              <button onClick={() => viewPaymentProof(i.id)} className="font-sans text-[11px] font-semibold text-action-primary underline">
                Lihat bukti
              </button>
              <button onClick={() => openRowUpload(i.id)} className="font-sans text-[11px] text-text-muted underline">
                Ganti
              </button>
            </div>
          );
        }
        // "PAID atau setelahnya" -- sebelum PAID belum ada apapun yang dibayar jadi belum relevan
        // untuk upload bukti pembayaran.
        if (i.status !== "WAITING_INVOICE" && i.status !== "INVOICED") {
          return (
            <button onClick={() => openRowUpload(i.id)} className="font-sans text-[11px] font-semibold text-action-primary underline">
              Upload
            </button>
          );
        }
        return <span className="font-sans text-[11px] text-text-muted">—</span>;
      },
    },
  ];

  return (
    <>
      {invoices.length > 0 && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-3 font-sans text-[11.5px] leading-[1.5] text-info-fg">
          Centang invoice berstatus INVOICED lalu klik Bayar untuk mengubah ke PAID. Bukti pembayaran (PDF) bersifat opsional -- bisa dilampirkan
          sekalian saat klik Bayar, atau menyusul kapan saja lewat kolom &quot;Bukti Pembayaran&quot;. Pembayaran juga dapat dibatalkan (kembali ke
          INVOICED) jika keliru.
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#CFE0EF] bg-info-bg px-5 py-[10px]">
          <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
          {selectableToPay.length > 0 && (
            <>
              <div className="flex flex-col">
                <label className="font-sans text-[10.5px] font-medium text-info-fg">Bukti pembayaran (opsional)</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => handleProofFileChange(e.target.files?.[0] ?? null)}
                  className="w-56 text-[10.5px] file:mr-1.5 file:rounded file:border-0 file:bg-white file:px-2 file:py-0.5 file:font-sans file:text-[10.5px] file:font-semibold file:text-info-fg"
                />
                {proofFileName && !proofError && <span className="font-sans text-[10.5px] text-success-fg">✓ {proofFileName} terupload.</span>}
                {proofError && <span className="font-sans text-[10.5px] text-danger-fg">{proofError}</span>}
              </div>
              <button
                onClick={handlePay}
                className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-success-fg"
              >
                Bayar ({selectableToPay.length})
              </button>
            </>
          )}
          {selectableToUnpay.length > 0 && (
            <button
              onClick={() => {
                setInvoicesPaid(selectableToUnpay.map((i) => i.id), false);
                setSelected(new Set());
              }}
              className="rounded-md border border-[#A8C5DF] bg-white px-2.5 py-[6px] font-sans text-[11.5px] font-semibold text-danger-fg"
            >
              Batalkan Bayar ({selectableToUnpay.length})
            </button>
          )}
        </div>
      )}

      <DataTable
        title="Semua invoice material"
        columns={columns}
        rows={invoices}
        keyOf={(i) => i.id}
        firstColumnLabel=""
        firstColumnRender={(i) => (
          <Checkbox checked={selected.has(i.id)} onChange={() => toggle(i.id)} disabled={i.status !== "INVOICED" && i.status !== "PAID"} />
        )}
        filterDefs={[
          { label: "No MRP", options: Array.from(new Set(invoices.map((i) => i.mrpId))), test: (i, v) => i.mrpId === v },
          { label: "No PO", options: Array.from(new Set(invoices.map((i) => i.poId))), test: (i, v) => i.poId === v },
          { label: "Entitas", options: Array.from(new Set(invoices.map((i) => i.entity))), test: (i, v) => i.entity === v },
          { label: "Status", options: Array.from(new Set(invoices.map((i) => i.status))), test: (i, v) => i.status === v },
        ]}
        emptyText="Belum ada invoice. Input di halaman Paying Voucher (Invoice) terlebih dahulu."
      />
    </>
  );
}
