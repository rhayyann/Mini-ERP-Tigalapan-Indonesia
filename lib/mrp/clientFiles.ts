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
export function viewAndDownloadFile(dataUrl: string) {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) {
    window.open(dataUrl, "_blank");
    return;
  }
  const meta = dataUrl.slice(5, commaIdx); // buang prefix "data:"
  const isBase64 = meta.endsWith(";base64");
  const mime = isBase64 ? meta.slice(0, -";base64".length) : meta.split(";")[0];
  try {
    const binary = isBase64 ? atob(dataUrl.slice(commaIdx + 1)) : decodeURIComponent(dataUrl.slice(commaIdx + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch {
    // Fallback kalau data URI-nya tidak terduga formatnya -- lebih baik coba apa adanya
    // (mungkin masih kena blokir, tapi tidak lebih buruk dari sebelumnya) daripada diam saja.
    window.open(dataUrl, "_blank");
  }
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
