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
