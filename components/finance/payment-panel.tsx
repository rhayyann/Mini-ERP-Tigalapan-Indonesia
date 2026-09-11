"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/mrp/number-input";
import { DataTable, type ColumnDef } from "@/components/mrp/data-table";
import { useMrpStore } from "@/lib/mrp/store";
import {
  claimKeySourceInvoiceId,
  formatDate,
  formatDecimal,
  formatRupiah,
  invoiceBadge,
  outstandingAmountForInvoice,
  vendorDepositBalance,
  vendorDepositCreditForClaim,
  vendorDepositEntriesFor,
} from "@/lib/mrp/derive";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";
import type { RawMaterialInvoice } from "@/lib/mrp/types";
// Item 2.7: getInvoicePaymentProofAction DIPANGGIL LANGSUNG dari komponen ini (bukan lewat store)
// -- sama pola dengan getMaterialClaimPhotoAction (material-claims/page.tsx), payload PDF-nya
// sengaja dikeluarkan dari snapshot (migration 0017), jadi cuma fetch on-demand saat user klik
// "Lihat bukti".
import { getInvoicePaymentProofAction } from "@/lib/mrp/actions";
// Revisi 2026-09-06: preview+download konsisten di semua modul -- lihat komentar di file ini.
// Revisi 2026-09-08 (bug fix popup blocked): openPreviewWindow/fillPreviewWindow -- lihat
// catatan panjang di lib/mrp/clientFiles.ts.
import { viewAndDownloadFile, openPreviewWindow, fillPreviewWindow } from "@/lib/mrp/clientFiles";

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
  const win = openPreviewWindow();
  try {
    const proof = await getInvoicePaymentProofAction(invoiceId);
    if (!proof) {
      win?.close();
      return;
    }
    fillPreviewWindow(win, proof.dataUrl);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Panel "Payment" (material) — konten diekstrak dari halaman lama /finance/payment,
 *  sekarang dipakai sebagai satu sub-tab di halaman gabungan /finance/payment. */
export function PaymentPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const invoices = useMrpStore((s) => s.invoices);
  const setInvoicesPaid = useMrpStore((s) => s.setInvoicesPaid);
  const setInvoicePaymentProof = useMrpStore((s) => s.setInvoicePaymentProof);
  // Item revisi 2026-09-06: dipakai untuk detail biaya maklon terkait begitu baris invoice
  // di-expand (lihat renderExpanded di bawah) -- Finance minta lihat "detail maklon" juga, bukan
  // cuma rincian material invoice-nya sendiri.
  const maklonPOs = useMrpStore((s) => s.maklonPOs);
  // Revisi 2026-09-06: saldo deposit vendor (dari klaim yang diselesaikan lewat "retur + pesan
  // ulang", lihat material-claims/page.tsx) -- fungible per supplier, dipakai manual di sini untuk
  // mengurangi pembayaran invoice APA PUN ke supplier yang sama.
  const vendorDeposits = useMrpStore((s) => s.vendorDeposits);
  const applyVendorDeposit = useMrpStore((s) => s.applyVendorDeposit);
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

  // Revisi 2026-09-06: jumlah saldo deposit yang mau dipakai untuk pembayaran ini -- SELALU
  // kosong/0 di awal (harus diisi manual oleh Finance, tidak pernah auto-terisi dari saldo yang
  // tersedia) & di-reset lagi setiap ganti seleksi invoice, supaya tidak kebawa nyangkut ke
  // seleksi berikutnya yang beda supplier/tagihan.
  const [depositAmount, setDepositAmount] = useState(0);
  const [showDepositDetail, setShowDepositDetail] = useState(false);
  // B2: increment ini setelah "Bayar" sukses untuk memaksa DataTable menutup baris yang sedang
  // ter-expand (lihat collapseSignal di data-table.tsx) -- TIDAK mereset filter/kolom tabel.
  const [collapseSignal, setCollapseSignal] = useState(0);

  if (!mounted) return null;

  const selectedList = invoices.filter((i) => selected.has(i.id));
  const selectableToPay = selectedList.filter((i) => i.status === "INVOICED");
  const selectableToUnpay = selectedList.filter((i) => i.status === "PAID");
  // Saldo deposit cuma relevan kalau SEMUA invoice yang mau dibayar berasal dari supplier yang
  // SAMA (ledger-nya per supplier, lihat vendor_deposits) -- kalau campur, sembunyikan kotaknya
  // dengan catatan, jangan tebak-tebak alokasi ke supplier mana.
  const paySuppliers = new Set(selectableToPay.map((i) => i.supplier));
  const depositSupplier = paySuppliers.size === 1 ? selectableToPay[0]?.supplier : undefined;
  const depositBalance = depositSupplier ? vendorDepositBalance(depositSupplier, vendorDeposits) : 0;
  // Item revisi 2026-09-07 (owner: "kenapa masih harus bayar dengan nilai pv terbaru? kan kita
  // cuman harus bayar selisihnya saja"): totalTagihan sekarang pakai SISA tagihan riil per invoice
  // (outstandingAmountForInvoice, sudah netting DEBIT deposit yang otomatis diterapkan saat PV
  // pengganti klaim dibuat -- lihat createClaimReplacementInvoiceAction), bukan totalBiaya mentah
  // lagi -- supaya kotak "Bayar" otomatis cuma minta selisihnya untuk PV pengganti yang kreditnya
  // sudah diterapkan otomatis. Untuk invoice biasa (atau PV pengganti LAMA dari sebelum revisi ini
  // yang belum sempat di-auto-apply), hasilnya identik dengan totalBiaya seperti sebelumnya.
  const totalTagihan = selectableToPay.reduce((a, i) => a + outstandingAmountForInvoice(i, vendorDeposits), 0);
  const depositCap = Math.max(0, Math.min(depositBalance, totalTagihan));
  const depositEntries = depositSupplier ? vendorDepositEntriesFor(depositSupplier, vendorDeposits) : [];
  // Revisi 2026-09-06 (v2): kalau yang dipilih PERSIS 1 invoice & itu PV pengganti hasil klaim,
  // tunjukkan selisihnya langsung (bukan minta Finance menghitung sendiri dari 2 angka) -- tombol
  // "Isi otomatis" tetap klik eksplisit, bukan auto-terisi (aturan "harus manual" tidak berubah).
  const singleClaimInvoice = selectableToPay.length === 1 && selectableToPay[0].sourceClaimId ? selectableToPay[0] : undefined;
  const claimCredit = singleClaimInvoice ? vendorDepositCreditForClaim(singleClaimInvoice.sourceClaimId!, vendorDeposits) : 0;
  const claimSelisih = singleClaimInvoice ? singleClaimInvoice.totalBiaya - claimCredit : 0;
  // Revisi 2026-09-07: sisa tagihan RIIL invoice ini (sudah netting DEBIT yang sudah diterapkan,
  // baik otomatis waktu dibuat MAUPUN manual dari sebelumnya) -- kalau sudah < totalBiaya berarti
  // kreditnya SUDAH diterapkan, "Isi otomatis" di bawah jadi tidak relevan lagi (disembunyikan).
  const claimOutstanding = singleClaimInvoice ? outstandingAmountForInvoice(singleClaimInvoice, vendorDeposits) : 0;
  const claimCreditAlreadyApplied = singleClaimInvoice ? singleClaimInvoice.totalBiaya - claimOutstanding : 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Ganti seleksi -- reset jumlah saldo deposit yang mau dipakai, supaya tidak kebawa nyangkut
    // ke tagihan/supplier baru (bisa jadi cap-nya sudah beda).
    setDepositAmount(0);
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

  // Item revisi 2026-09-06: bukti pembayaran SEKARANG WAJIB sebelum tombol "Bayar" bisa diklik --
  // dulu opsional (bisa dilampirkan belakangan lewat kolom "Bukti Pembayaran"), tapi Finance minta
  // dibalik supaya tidak ada invoice yang ke-PAID tanpa bukti transfer sama sekali. Upload
  // belakangan lewat kolom di tabel (openRowUpload) TETAP ada untuk kasus invoice lama yang
  // terlanjur PAID sebelum aturan ini berlaku.
  const canPay = !!proofDataUrl && selectableToPay.length > 0;

  async function handlePay() {
    if (!proofDataUrl) return;
    const ids = selectableToPay.map((i) => i.id);
    await setInvoicesPaid(ids, true);
    await setInvoicePaymentProof(ids, proofDataUrl, proofFileName);
    // Revisi 2026-09-06: pakai saldo deposit HANYA kalau Finance benar-benar mengisi jumlahnya
    // (default 0, tidak pernah auto) -- di-clamp lagi ke depositCap di sini sebagai jaring
    // pengaman terakhir sebelum dikirim (server sendiri tetap validasi ulang, lihat
    // applyVendorDepositAction), untuk jaga-jaga kalau cap sempat berubah antara input & klik.
    const amountToApply = Math.min(depositAmount, depositCap);
    if (depositSupplier && amountToApply > 0) {
      await applyVendorDeposit(depositSupplier, amountToApply, ids);
    }
    setSelected(new Set());
    setProofDataUrl(undefined);
    setProofFileName(undefined);
    setProofError("");
    setDepositAmount(0);
    // B2: seluruh await di atas sukses (tidak throw) -- picu auto-collapse baris yang sedang
    // ter-expand (lihat collapseSignal di data-table.tsx). Kalau salah satu await di atas throw,
    // fungsi ini berhenti lebih awal & baris tidak (t)erkolaps.
    setCollapseSignal((v) => v + 1);
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

  // Revisi 2026-09-07: susunan default diminta ulang jadi fokus ke rekonsiliasi klaim -- No MRP,
  // No PO, PO Reference, Harga, Pembayaran Sebelumnya, Selisih, Status (+ Lampiran/Bukti Pembayaran
  // tetap default di ujung karena keduanya aksi inti alur Bayar, bukan cuma info). Kode Transaksi/
  // Supplier/No Invoice Supplier pindah ke toggle "Kolom" (tetap ada, cuma tidak lagi kolom
  // pertama yang kelihatan). Status Klaim (badge "Deposit +Rp...") DIHAPUS sebagai kolom terpisah
  // -- badge-nya sekarang menyatu di kolom "Status" (lihat render "status" di bawah) supaya
  // langsung kelihatan baris mana yang jadi saldo deposit tanpa buka kolom tambahan.
  const columns: ColumnDef<RawMaterialInvoice>[] = [
    { key: "noMrp", label: "No MRP", default: true, render: (i) => <span className="font-mono">{i.mrpId}</span> },
    { key: "noPo", label: "No PO", default: true, render: (i) => <span className="font-mono font-medium">{i.poId}</span> },
    // Revisi 2026-09-06 (v2): "PO Reference" ke invoice LAMA yang diretur (cuma terisi untuk PV
    // pengganti hasil klaim, lihat sourceClaimId di types.ts) -- "—" untuk invoice biasa.
    {
      key: "poReferenceLama",
      label: "PO Reference",
      default: true,
      render: (i) => (i.sourceClaimId ? <span className="font-mono">{claimKeySourceInvoiceId(i.sourceClaimId)}</span> : <span className="font-sans text-[11px] text-text-muted">—</span>),
    },
    { key: "nilai", label: "Harga", default: true, align: "right", render: (i) => formatRupiah(i.totalBiaya) },
    {
      key: "pembayaranSebelumnya",
      label: "Pembayaran Sebelumnya",
      default: true,
      align: "right",
      render: (i) =>
        i.sourceClaimId ? <span className="font-mono">{formatRupiah(vendorDepositCreditForClaim(i.sourceClaimId, vendorDeposits))}</span> : <span className="font-sans text-[11px] text-text-muted">—</span>,
    },
    {
      key: "selisihKlaim",
      label: "Selisih",
      default: true,
      align: "right",
      render: (i) => {
        if (!i.sourceClaimId) return <span className="font-sans text-[11px] text-text-muted">—</span>;
        const selisih = i.totalBiaya - vendorDepositCreditForClaim(i.sourceClaimId, vendorDeposits);
        return (
          <span className={"font-mono font-medium " + (selisih < 0 ? "text-success-fg" : "text-warning-fg")}>
            {selisih >= 0 ? "+" : "−"}
            {formatRupiah(Math.abs(selisih))}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      default: true,
      render: (i) => {
        // "Deposit" cuma untuk kasus PV pengganti klaim yang LEBIH MURAH dari PV lama (selisih
        // negatif) -- sesuai kesepakatan dengan owner. Ditumpuk di bawah badge status biasa supaya
        // langsung kelihatan baris mana yang jadi saldo deposit tanpa buka kolom terpisah lagi.
        const selisih = i.sourceClaimId ? i.totalBiaya - vendorDepositCreditForClaim(i.sourceClaimId, vendorDeposits) : 0;
        const isDeposit = !!i.sourceClaimId && selisih < 0;
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusPill tone={invoiceBadge(i.status).tone}>{invoiceBadge(i.status).label}</StatusPill>
            {isDeposit && <StatusPill tone="success">Deposit +{formatRupiah(-selisih)}</StatusPill>}
          </div>
        );
      },
    },
    { key: "kodeTransaksi", label: "Kode Transaksi", default: false, render: (i) => <span className="font-mono font-medium">{i.kodeTransaksi}</span> },
    { key: "supplier", label: "Supplier / Vendor", default: false, render: (i) => `${i.supplier} → ${VENDOR_PRODUKSI[i.destinationVendor]?.name ?? i.destinationVendor}` },
    { key: "noInvVendor", label: "No Invoice Supplier", default: false, render: (i) => i.noInvoiceVendor || "—" },
    {
      key: "sumber",
      label: "Sumber",
      default: false,
      render: (i) => (i.sourceClaimId ? <StatusPill tone="info">Reorder klaim</StatusPill> : <span className="font-sans text-[11px] text-text-muted">PO biasa</span>),
    },
    { key: "roll", label: "Roll", default: false, align: "right", render: (i) => i.qtyReady },
    { key: "entitas", label: "Entitas", default: false, render: (i) => i.entity },
    {
      key: "bukti",
      label: "Lampiran Invoice",
      default: true,
      render: (i) =>
        i.buktiPvDataUrl ? (
          <button onClick={() => viewAndDownloadFile(i.buktiPvDataUrl!)} className="font-sans text-[11px] font-semibold text-action-primary underline">
            Lihat / Download
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
                Lihat / Download
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
      {/* Item 5 (feedback batch 2026-09-10, owner: "Hilangkan saja yang teks guide itu"): banner
         panduan panjang dihapus -- alur Bayar/Bukti Pembayaran sudah cukup jelas dari label kolom
         & tombol aksi sendiri. */}

      {selected.size > 0 && (
        <div className="rounded-lg border border-[#CFE0EF] bg-info-bg p-4">
          <div className="flex items-center justify-between">
            <span className="font-sans text-xs font-medium text-info-fg">{selected.size} dipilih</span>
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

          {selectableToPay.length > 0 && (
            <>
              {/* Revisi 2026-09-06 (v2): dulu flex-wrap items-end -- box bukti pembayaran & box
                 saldo deposit jadi tidak presisi (lebar & tinggi beda-beda tergantung isi), dan
                 tombol Bayar ikut kena bottom-align jadi kelihatan aneh. Sekarang grid 2 kolom
                 SAMA LEBAR (h-full menyamakan tinggi keduanya ke baris tertinggi), tombol Bayar
                 dipindah ke barisnya sendiri di bawah supaya tidak perlu ikut menyesuaikan tinggi
                 box sama sekali. */}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="flex h-full flex-col gap-1.5 rounded-md border border-dashed border-[#8FB3D9] bg-white px-3.5 py-3">
                  <label className="font-sans text-[10.5px] font-semibold uppercase tracking-wider text-info-fg">
                    Bukti Pembayaran (PDF) <span className="text-danger-fg">*wajib</span>
                  </label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => handleProofFileChange(e.target.files?.[0] ?? null)}
                    className="w-full text-[10.5px] file:mr-1.5 file:rounded file:border-0 file:bg-info-bg file:px-2 file:py-1 file:font-sans file:text-[10.5px] file:font-semibold file:text-info-fg"
                  />
                  {proofFileName && !proofError && <span className="font-sans text-[10.5px] font-medium text-success-fg">✓ {proofFileName} terupload.</span>}
                  {!proofFileName && !proofError && <span className="font-sans text-[10.5px] text-text-muted">Belum ada file dipilih.</span>}
                  {proofError && <span className="font-sans text-[10.5px] font-medium text-danger-fg">{proofError}</span>}
                </div>

                {/* Saldo deposit vendor (dari klaim yang diselesaikan lewat "retur + pesan ulang")
                   -- SELALU kosong di awal & dipilih manual (bukan auto mengurangi tagihan),
                   dengan rincian asal saldo yang bisa dibuka supaya tidak jadi angka blackbox.
                   Kotak ini cuma muncul kalau seluruh invoice terpilih dari SATU supplier yang
                   sama & supplier itu punya saldo > 0 -- kalau tidak, kolom kedua kosong (bukan
                   dipaksa 1 kolom penuh) supaya grid tetap presisi & tidak "loncat" lebar. */}
                {depositSupplier && depositBalance > 0 ? (
                  <div className="flex h-full flex-col gap-1.5 rounded-md border border-dashed border-[#B7DFC5] bg-white px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <label className="font-sans text-[10.5px] font-semibold uppercase tracking-wider text-success-fg">Saldo Deposit {depositSupplier}</label>
                      <button type="button" onClick={() => setShowDepositDetail((v) => !v)} className="font-sans text-[10px] font-semibold text-action-primary underline">
                        {showDepositDetail ? "Sembunyikan" : "Lihat rincian"}
                      </button>
                    </div>
                    <div className="font-sans text-[11px] text-text-muted">
                      Tersedia: <span className="font-mono font-semibold text-success-fg">{formatRupiah(depositBalance)}</span>
                    </div>
                    {showDepositDetail && (
                      <div className="max-h-24 overflow-y-auto rounded border border-[#E4E8EE] bg-[#FAFBFC] px-2 py-1.5">
                        {depositEntries.length === 0 ? (
                          <div className="font-sans text-[10.5px] text-text-muted">Belum ada riwayat.</div>
                        ) : (
                          depositEntries.map((e) => (
                            <div key={e.id} className="flex items-center justify-between gap-2 border-b border-[#F1F4F7] py-1 font-sans text-[10.5px] text-[#31414F] last:border-b-0">
                              <span>
                                {formatDate(e.createdAt)} — {e.kind === "CREDIT" ? `kredit dari klaim ${e.sourceClaimId ?? "—"}` : `dipakai bayar ${e.sourceInvoiceId ?? "—"}`}
                              </span>
                              <span className={"flex-none font-mono font-medium " + (e.kind === "CREDIT" ? "text-success-fg" : "text-danger-fg")}>
                                {e.kind === "CREDIT" ? "+" : "−"}
                                {formatRupiah(e.amount)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                    {/* Kalau invoice terpilih PERSIS PV pengganti klaim, tunjukkan selisihnya
                       langsung -- Finance tidak perlu hitung manual dari 2 angka terpisah.
                       Revisi 2026-09-07: PV pengganti BARU (dibuat setelah revisi ini) sudah
                       auto-terapkan kreditnya sendiri saat dibuat (lihat
                       createClaimReplacementInvoiceAction) -- box di sini jadi MURNI informasi,
                       tombol "Isi otomatis" cuma muncul untuk PV pengganti LAMA (dari sebelum
                       revisi ini) yang kreditnya belum sempat diterapkan otomatis. */}
                    {singleClaimInvoice && (
                      <div className="rounded border border-[#E4E8EE] bg-[#FAFBFC] px-2 py-1.5 font-sans text-[10.5px] text-text-muted">
                        Invoice ini PV pengganti klaim — nilai lama {formatRupiah(claimCredit)}, nilai baru {formatRupiah(singleClaimInvoice.totalBiaya)},{" "}
                        <span className={claimSelisih < 0 ? "font-semibold text-success-fg" : "font-semibold text-warning-fg"}>
                          selisih {claimSelisih >= 0 ? "+" : "−"}
                          {formatRupiah(Math.abs(claimSelisih))}
                        </span>
                        .{" "}
                        {claimCreditAlreadyApplied > 0.5 ? (
                          <span>
                            Kredit retur Rp {formatRupiah(claimCreditAlreadyApplied)} <span className="font-semibold text-success-fg">sudah otomatis diterapkan</span> ke invoice ini — sisa
                            yang perlu dibayar cuma <span className="font-semibold text-info-fg">{formatRupiah(claimOutstanding)}</span>.
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDepositAmount(Math.max(0, Math.min(claimCredit, singleClaimInvoice.totalBiaya, depositCap)))}
                            className="font-semibold text-action-primary underline"
                            title="Isi sebanyak kredit yang bisa dipakai untuk invoice ini -- kalau kredit lebih besar dari tagihan ini, sisanya tetap tersimpan sebagai saldo deposit untuk invoice lain nanti."
                          >
                            Isi otomatis
                          </button>
                        )}
                      </div>
                    )}
                    <div className="mt-auto flex flex-col gap-1">
                      <label className="font-sans text-[10.5px] font-medium text-text-muted">Pakai untuk pembayaran ini (isi manual, opsional)</label>
                      <NumberInput value={depositAmount} onChange={(v) => setDepositAmount(Math.max(0, Math.min(v, depositCap)))} currency placeholder="Rp 0" className="input w-full text-[11px]" />
                      <div className="font-sans text-[10px] text-text-muted">Maks {formatRupiah(depositCap)} untuk {selectableToPay.length} invoice terpilih ini.</div>
                    </div>
                  </div>
                ) : (
                  paySuppliers.size > 1 && (
                    <div className="flex h-full items-center rounded-md border border-dashed border-[#DDE4EB] bg-white px-3.5 py-3 font-sans text-[10.5px] text-text-muted">
                      Pilih invoice dari 1 supplier yang sama untuk bisa pakai saldo deposit.
                    </div>
                  )
                )}
              </div>

              <div className="mt-3 flex items-center justify-end gap-2.5">
                {depositAmount > 0 && (
                  <span className="font-sans text-[11.5px] text-text-muted">
                    Total {formatRupiah(totalTagihan)} − saldo {formatRupiah(depositAmount)} = <span className="font-semibold text-info-fg">net {formatRupiah(Math.max(0, totalTagihan - depositAmount))}</span>
                  </span>
                )}
                <button
                  onClick={handlePay}
                  disabled={!canPay}
                  title={!proofDataUrl ? "Upload bukti pembayaran (PDF) dulu" : undefined}
                  className="flex-none rounded-md border border-[#A8C5DF] bg-white px-3.5 py-[8px] font-sans text-[11.5px] font-semibold text-success-fg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Bayar ({selectableToPay.length})
                </button>
              </div>
            </>
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
        collapseSignal={collapseSignal}
        // Item revisi 2026-09-06: klik baris untuk lihat detail material (rincian per warna + add
        // buy) DAN detail maklon (biaya PO Produksi terkait) sekaligus, supaya Finance bisa lihat
        // apa yang sebenarnya harus dibayar tanpa pindah halaman.
        renderExpanded={(i) => {
          const relatedMaklon = maklonPOs.find((p) => p.mrpId === i.mrpId && p.vendorProduksi === i.destinationVendor);
          const materialSubtotal = i.colorEntries.reduce((a, c) => a + c.hargaPerRoll * c.rolls.reduce((s, w) => s + w, 0), 0);
          const addBuyTotal = i.addBuys.reduce((a, b) => a + b.totalHarga, 0);
          const claimCreditForRow = i.sourceClaimId ? vendorDepositCreditForClaim(i.sourceClaimId, vendorDeposits) : 0;
          const claimSelisihForRow = i.totalBiaya - claimCreditForRow;
          const outstandingForRow = outstandingAmountForInvoice(i, vendorDeposits);
          const creditAlreadyAppliedForRow = i.totalBiaya - outstandingForRow;
          return (
            <div className="flex flex-col gap-3">
              {i.sourceClaimId && (
                <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                  <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Detail Klaim (PV Pengganti)</div>
                  <div className="grid grid-cols-2 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                    <span>PO Reference (lama)</span>
                    <span className="text-right font-mono">{claimKeySourceInvoiceId(i.sourceClaimId)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                    <span>PO Terbaru (PV pengganti ini)</span>
                    <span className="text-right font-mono">{i.id}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                    <span>Pembayaran sebelumnya (nilai PV lama)</span>
                    <span className="text-right font-mono">{formatRupiah(claimCreditForRow)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                    <span>Nilai PV pengganti ini</span>
                    <span className="text-right font-mono">{formatRupiah(i.totalBiaya)}</span>
                  </div>
                  <div className={"grid grid-cols-2 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] font-semibold " + (claimSelisihForRow < 0 ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg")}>
                    <span>Selisih{claimSelisihForRow < 0 ? " (jadi saldo deposit)" : " (kekurangan dibayar)"}</span>
                    <span className="text-right font-mono">
                      {claimSelisihForRow >= 0 ? "+" : "−"}
                      {formatRupiah(Math.abs(claimSelisihForRow))}
                    </span>
                  </div>
                </div>
              )}
              <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">Detail Material — {i.id}</div>
                {/* BUG FIX 2026-09-07: kolom "Harga/roll" dulu salah label -- field-nya (ColorEntry.
                    hargaPerRoll) ITU HARGA PER KG (lihat label input aslinya "Harga / kg" di
                    paying-voucher-wizard.tsx), dan Subtotal SUDAH DIHITUNG benar (harga x TOTAL KG
                    semua roll warna itu, bukan x jumlah roll) -- cuma labelnya menyesatkan seolah
                    dikali jumlah roll. Sekarang jumlah roll & total berat (kg) ditampilkan sebagai
                    2 kolom terpisah supaya kelihatan jelas subtotal = Total Berat x Harga/Kg. */}
                <div className="grid grid-cols-5 gap-x-2 border-t border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  <span>Warna / lengan</span>
                  <span className="text-right">Roll</span>
                  <span className="text-right">Total Berat (kg)</span>
                  <span className="text-right">Harga/Kg</span>
                  <span className="text-right">Subtotal</span>
                </div>
                {i.colorEntries.map((c, idx) => {
                  const totalKg = c.rolls.reduce((s, w) => s + w, 0);
                  return (
                    <div key={idx} className="grid grid-cols-5 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                      <span className="font-medium">
                        {c.warna} · {c.lengan}
                      </span>
                      <span className="text-right font-mono">{c.rolls.length}</span>
                      <span className="text-right font-mono">{formatDecimal(totalKg)}</span>
                      <span className="text-right font-mono">{formatRupiah(c.hargaPerRoll)}</span>
                      <span className="text-right font-mono">{formatRupiah(c.hargaPerRoll * totalKg)}</span>
                    </div>
                  );
                })}
                {i.addBuys.length > 0 && (
                  <>
                    <div className="grid grid-cols-5 gap-x-2 border-t border-[#F1F4F7] bg-[#FAFBFC] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                      <span>Add buy</span>
                      <span />
                      <span className="text-right">Berat (kg)</span>
                      <span className="text-right">Harga/Kg</span>
                      <span className="text-right">Subtotal</span>
                    </div>
                    {i.addBuys.map((b) => (
                      <div key={b.id} className="grid grid-cols-5 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                        <span className="font-medium">
                          {b.item} · {b.warna}
                        </span>
                        <span />
                        <span className="text-right font-mono">{formatDecimal(b.beratKg)}</span>
                        <span className="text-right font-mono">{b.hargaPerKg != null ? formatRupiah(b.hargaPerKg) : "—"}</span>
                        <span className="text-right font-mono">{formatRupiah(b.totalHarga)}</span>
                      </div>
                    ))}
                  </>
                )}
                <div className="grid grid-cols-5 gap-x-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[11.5px] font-semibold text-info-fg">
                  <span>Material + add buy</span>
                  <span />
                  <span />
                  <span />
                  <span className="text-right font-mono">{formatRupiah(materialSubtotal + addBuyTotal)}</span>
                </div>
                {i.diskon > 0 && (
                  <div className="grid grid-cols-5 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-danger-fg">
                    <span>Diskon</span>
                    <span />
                    <span />
                    <span />
                    <span className="text-right font-mono">-{formatRupiah(i.diskon)}</span>
                  </div>
                )}
                <div className="grid grid-cols-5 gap-x-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[12px] font-bold text-info-fg">
                  <span>Nilai PV ini</span>
                  <span />
                  <span />
                  <span />
                  <span className="text-right font-mono">{formatRupiah(i.totalBiaya)}</span>
                </div>
                {/* Revisi 2026-09-07: "Total yang harus dibayar" dulu SELALU sama dengan nilai PV
                   mentah (i.totalBiaya) -- salah untuk PV pengganti klaim yang kreditnya sudah
                   diterapkan (auto atau manual), karena tagihan RIIL yang perlu dibayar sudah
                   dikurangi kredit itu (lihat outstandingAmountForInvoice). Baris "Nilai PV ini" di
                   atas tetap tampilkan nilai ASLI (untuk histori/HPP), baris ini baru tunjukkan
                   sisa tagihan RIIL yang dipakai kotak "Bayar" -- cuma beda kalau ada kredit yang
                   sudah diterapkan, kalau tidak ada dua baris ini akan sama persis. */}
                {creditAlreadyAppliedForRow > 0.5 && (
                  <div className="grid grid-cols-5 gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-success-fg">
                    <span>Sudah ditutup kredit retur PV lama</span>
                    <span />
                    <span />
                    <span />
                    <span className="text-right font-mono">−{formatRupiah(creditAlreadyAppliedForRow)}</span>
                  </div>
                )}
                <div className="grid grid-cols-5 gap-x-2 border-t-2 border-accent-blue bg-info-bg px-3 py-1.5 font-sans text-[12px] font-bold text-info-fg">
                  <span>Total yang harus dibayar (invoice ini)</span>
                  <span />
                  <span />
                  <span />
                  <span className="text-right font-mono">{formatRupiah(outstandingForRow)}</span>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-[#E4E8EE] bg-white">
                <div className="bg-[#F2F4F7] px-3 py-1.5 font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  Detail Maklon (PO Produksi terkait)
                </div>
                {relatedMaklon ? (
                  <div className="grid grid-cols-3 items-center gap-x-2 border-t border-[#F1F4F7] px-3 py-1.5 font-sans text-[11.5px] text-[#31414F]">
                    <span className="font-mono font-medium">{relatedMaklon.id}</span>
                    <span>{VENDOR_PRODUKSI[relatedMaklon.vendorProduksi]?.name ?? relatedMaklon.vendorProduksi}</span>
                    <span className="text-right font-mono">Biaya maklon: {formatRupiah(relatedMaklon.amount)}</span>
                  </div>
                ) : (
                  <div className="border-t border-[#F1F4F7] px-3 py-2 font-sans text-[11.5px] text-text-muted">Belum ada PO Produksi terkait untuk MRP/vendor ini.</div>
                )}
              </div>
            </div>
          );
        }}
      />
    </>
  );
}
