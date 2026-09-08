"use client";

/** Item revisi 2026-09-06: "file yang diupload (bukti PV, bukti pembayaran, foto klaim) harus bisa
 *  di-preview DAN di-download, diterapkan konsisten di semua modul (Procurement/Finance/Vendor
 *  Produksi)" -- sebelumnya tiap halaman punya cara sendiri-sendiri (kebanyakan cuma
 *  `window.open(dataUrl)`, yang MEMANG membuka file-nya tapi user harus tahu sendiri cara
 *  men-download dari situ -- beda-beda tergantung viewer PDF/gambar bawaan browser). Satu fungsi
 *  dipakai bareng di semua tempat supaya perilakunya konsisten di semua modul.
 *
 *  Revisi 2026-09-07: owner minta trigger download OTOMATIS (elemen `<a download>` yang diklik
 *  programatik, dulu jalan berbarengan dengan window.open) dihapus -- "tidak perlu download, jadi
 *  ke tab browser dulu baru nanti download dari situ". Sekarang MURNI buka tab baru untuk preview;
 *  user download sendiri lewat viewer PDF/gambar bawaan browser di tab itu kalau memang perlu.
 *  Parameter `fileName` DIHAPUS dari signature (dulu cuma dipakai untuk `<a download>` yang
 *  sekarang tidak ada lagi) -- semua caller di-update ikut menghapus argumen ini.
 *
 *  PENTING: `window.open(dataUrl)` LANGSUNG ke string "data:..." DIBLOKIR browser modern (Chrome
 *  sejak versi 65 menolak navigasi top-level ke skema data: lewat window.open, murni proteksi
 *  anti-phishing bawaan browser -- bukan popup-blocker biasa, jadi tidak ada workaround dari sisi
 *  App kalau tetap pakai data: URI mentah). Makanya di sini data URI dikonversi dulu jadi
 *  Blob + `URL.createObjectURL` (skema `blob:` TIDAK kena blokir yang sama) sebelum di-window.open.
 *  Blob URL sengaja di-revoke belakangan (bukan langsung) supaya tab baru sempat selesai memuat
 *  isinya dulu. */
/** Konversi data URI -> blob: URL (skema yang tidak kena blokir `window.open` seperti data:).
 *  Return null kalau formatnya tidak terduga -- caller fallback ke `window.open(dataUrl)` apa
 *  adanya. Diekstrak dari `viewAndDownloadFile` (item revisi 2026-09-08) supaya bisa dipakai
 *  ulang oleh `fillPreviewWindow` -- lihat catatan di sana soal kenapa keduanya perlu jalur
 *  konversi yang sama tapi TIDAK sama-sama manggil `window.open`. */
function dataUrlToBlobUrl(dataUrl: string): string | null {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return null;
  const meta = dataUrl.slice(5, commaIdx); // buang prefix "data:"
  const isBase64 = meta.endsWith(";base64");
  const mime = isBase64 ? meta.slice(0, -";base64".length) : meta.split(";")[0];
  try {
    const binary = isBase64 ? atob(dataUrl.slice(commaIdx + 1)) : decodeURIComponent(dataUrl.slice(commaIdx + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  } catch {
    return null;
  }
}

export function viewAndDownloadFile(dataUrl: string) {
  const blobUrl = dataUrlToBlobUrl(dataUrl);
  if (!blobUrl) {
    // Fallback kalau data URI-nya tidak terduga formatnya -- lebih baik coba apa adanya
    // (mungkin masih kena blokir, tapi tidak lebih buruk dari sebelumnya) daripada diam saja.
    window.open(dataUrl, "_blank");
    return;
  }
  window.open(blobUrl, "_blank");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** Item revisi 2026-09-08 (bug fix "Bukti Pembayaran tidak bisa diklik"): buka tab kosong
 *  SEKARANG, secara SINKRON di dalam onClick handler -- SEBELUM `await` Server Action apa pun --
 *  supaya browser masih menganggap tab ini "dipicu langsung oleh klik user". `window.open()`
 *  yang dipanggil SETELAH `await` (mis. fetch bukti pembayaran on-demand karena datanya sengaja
 *  tidak ikut snapshot awal, lihat getInvoicePaymentProofAction/getMaterialClaimPhotoAction)
 *  kehilangan status "user gesture" itu di browser modern dan DIAM-DIAM diblokir popup blocker --
 *  inilah sebabnya tombol "Bukti Pembayaran"/"Bukti Klaim" kelihatan seperti tidak melakukan
 *  apa-apa waktu diklik, padahal fetch-nya sendiri sukses. Isi tab ini belakangan lewat
 *  `fillPreviewWindow` begitu data selesai di-fetch. */
export function openPreviewWindow(): Window | null {
  return window.open("", "_blank");
}

/** Isi tab yang SUDAH dibuka (dari `openPreviewWindow`, dipanggil SEBELUM await) dengan file
 *  hasil fetch on-demand. Kalau `win` null (jarang -- tetap diblokir meski sudah dicoba lebih
 *  awal, mis. browser yang memblokir SEMUA popup tanpa kecuali), fallback ke
 *  `viewAndDownloadFile` biasa -- masih mungkin diblokir, tapi tidak lebih buruk dari sebelumnya. */
export function fillPreviewWindow(win: Window | null, dataUrl: string) {
  if (!win) {
    viewAndDownloadFile(dataUrl);
    return;
  }
  const blobUrl = dataUrlToBlobUrl(dataUrl);
  if (!blobUrl) {
    win.location.href = dataUrl;
    return;
  }
  win.location.href = blobUrl;
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/** Ukuran string base64 APA ADANYA (1 karakter base64 = 1 byte ASCII di payload yang benar-benar
 *  dikirim) -- dipakai untuk cek batas ukuran file yang di-encode ke data URI SEBELUM dikirim ke
 *  Server Action, bukan `file.size` mentah (base64 menggembungkan ukuran ~33%). Disalin dari
 *  payment-panel.tsx (yang punya catatan panjang soal kenapa pengukuran ini harus begini, lihat
 *  riwayat Round-2/Round-3 fix di sana) -- dipakai lagi di sini (claim-replacement-modal.tsx) biar
 *  konsisten, bukan menulis ulang versi ketiga yang berisiko salah lagi. */
export function dataUrlEncodedBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return b64.length;
}

/** Batas ASLI hasil-encode untuk upload PDF lewat Server Action -- margin di bawah limit body 2 MB
 *  (next.config.ts), sama nilainya dengan MAX_PROOF_ENCODED_BYTES di payment-panel.tsx. */
export const MAX_PDF_ENCODED_BYTES = 1.5 * 1024 * 1024;

/** Baca 1 file PDF jadi data URI, dengan validasi tipe + ukuran -- dipakai claim-replacement-modal.tsx
 *  untuk upload "Bukti Invoice". Resolve dengan pesan error (string) kalau gagal, atau
 *  {dataUrl, fileName} kalau berhasil -- caller tinggal cek `"error" in result`. */
export function readPdfAsDataUrl(file: File): Promise<{ dataUrl: string; fileName: string } | { error: string }> {
  return new Promise((resolve) => {
    if (file.type !== "application/pdf") {
      resolve({ error: "File harus berformat PDF." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrlEncodedBytes(dataUrl) > MAX_PDF_ENCODED_BYTES) {
        resolve({ error: "File terlalu besar — kompres dulu PDF-nya." });
        return;
      }
      resolve({ dataUrl, fileName: file.name });
    };
    reader.onerror = () => resolve({ error: "Gagal membaca file, coba lagi." });
    reader.readAsDataURL(file);
  });
}
