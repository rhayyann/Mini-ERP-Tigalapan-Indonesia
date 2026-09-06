"use client";

/** Item revisi 2026-09-06: "file yang diupload (bukti PV, bukti pembayaran, foto klaim) harus bisa
 *  di-preview DAN di-download, diterapkan konsisten di semua modul (Procurement/Finance/Vendor
 *  Produksi)" -- sebelumnya tiap halaman punya cara sendiri-sendiri (kebanyakan cuma
 *  `window.open(dataUrl)`, yang MEMANG membuka file-nya tapi user harus tahu sendiri cara
 *  men-download dari situ -- beda-beda tergantung viewer PDF/gambar bawaan browser). Sekarang satu
 *  fungsi dipakai bareng di semua tempat: buka tab baru untuk preview (perilaku user paling
 *  familiar) SEKALIGUS trigger download otomatis lewat elemen `<a download>` sementara (tidak
 *  ditaruh di DOM, cukup diklik programatik) -- pola ini sendiri sudah dipakai duluan di
 *  app/procurement/material-claims/page.tsx (viewClaimPhoto), cuma belum konsisten di tempat lain.
 *  Aman dipakai untuk file apa pun yang disimpan sebagai data-URI base64 (PDF maupun gambar). */
export function viewAndDownloadFile(dataUrl: string, fileName?: string) {
  window.open(dataUrl, "_blank");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName || "file";
  a.click();
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
