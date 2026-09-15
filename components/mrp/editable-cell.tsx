"use client";

import type { ReactNode } from "react";

/** Item revisi 2026-09-15 (owner: "Master Data rentan salah ketik, harus klik Edit dulu") --
 *  pembungkus tipis: tampilkan `display` (teks biasa read-only) kalau `editing` false, ATAU
 *  `children` (elemen input/select/NumberInput yang SUDAH ADA, tidak diubah sama sekali) kalau
 *  `editing` true. TIDAK menyimpan state apa pun sendiri -- state "baris mana yang sedang edit"
 *  tetap hidup di panel pemanggil (lihat kerah-manset-settings-panel.tsx dkk), komponen ini murni
 *  switch tampilan. */
export function EditableCell({
  editing,
  display,
  children,
  displayClassName,
}: {
  editing: boolean;
  display: ReactNode;
  children: ReactNode;
  /** Opsional -- tempel class TAMBAHAN (mis. `flex-1 max-w-[320px]`) ke span read-only supaya
   *  ukurannya konsisten dengan elemen input yang digantikannya (item review: tanpa ini, tombol
   *  Edit/Hapus di baris kustom seperti supplier-panel.tsx bisa "meloncat" posisi saat toggle
   *  mode, karena span default tidak ikut `flex-1` seperti input aslinya). Default kosong -- panel
   *  berbasis DataTable (sel `<td>` sudah membungkus lebar sendiri) tidak perlu ini sama sekali. */
  displayClassName?: string;
}) {
  if (!editing) return <span className={"font-sans text-xs text-[#31414F]" + (displayClassName ? " " + displayClassName : "")}>{display}</span>;
  return <>{children}</>;
}
