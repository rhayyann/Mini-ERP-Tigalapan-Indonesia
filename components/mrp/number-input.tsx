"use client";

import { useEffect, useState } from "react";

function parseLocaleNumber(s: string): number {
  const cleaned = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Item 5 (feedback batch 2026-09-04) — dipakai HANYA saat `commaOnly` true. Beda dari
 *  parseLocaleNumber di atas: TIDAK menganggap "." sebagai pemisah ribuan (yang jadi root cause
 *  bug "25.5" disimpan jadi 255) -- di sini "." sudah tidak pernah lolos ke state sama sekali
 *  (difilter saat onChange, lihat commaOnlyFilter), jadi cukup ganti koma jadi titik lalu parse. */
function parseCommaNumber(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/** Filter untuk field `commaOnly`, dipanggil dari onChange dengan `insertedText` = teks yang BARU
 *  SAJA masuk, diambil dari `InputEvent.data` milik browser sendiri -- akurat untuk ketik SATU
 *  KARAKTER maupun PASTE sekaligus (browser isi `.data` dengan seluruh teks yang disisipkan di
 *  kedua kasus), dan otomatis `null` untuk hapus/backspace/delete (browser tidak pernah isi
 *  `.data` untuk operasi hapus) -- jadi hapus SELALU lolos tanpa perlu dicek.
 *
 *  Kalau teks yang baru masuk itu (apa pun panjangnya) mengandung karakter di luar [0-9,-],
 *  SELURUH perubahan ini ditolak -- balik ke `prevText` apa adanya, TIDAK memotong sebagian.
 *
 *  Riwayat 2 iterasi sebelumnya (keduanya ditemukan lewat live-test, bukan cuma baca kode):
 *   1. Versi awal buang SEMUA karakter tidak valid dari string manapun ("." dibuang, digit
 *      kiri-kanannya nyambung) -- aman untuk ketik satu-satu (user LIHAT "." hilang seketika,
 *      belum sempat lanjut ngetik), tapi paste "25.5" (satu event, seluruh string sekaligus)
 *      jadi "255" -- 10x lipat, diam-diam, PERSIS bug yang item ini dibuat untuk dihilangkan.
 *   2. Versi potong-di-karakter-invalid-pertama memperbaiki kasus paste (jadi "25", jelas kurang
 *      lengkap, gampang disadari) TAPI merusak edit di TENGAH angka yang sudah benar -- mis. field
 *      berisi "1000", user klik di antara "10" dan "00" lalu salah ketik "." -> potong di situ
 *      menghapus "00" di belakang juga, padahal itu tidak ada hubungannya dengan salah ketiknya.
 *  Pendekatan sekarang (pakai `InputEvent.data`, bukan menganalisis string hasil akhir) memperbaiki
 *  keduanya sekaligus: tahu PERSIS apa yang baru disisipkan (bukan cuma "ada karakter aneh di
 *  suatu tempat"), jadi bisa tolak SELURUH penyisipan itu tanpa menyentuh karakter lain yang
 *  sudah benar sebelumnya. */
function commaOnlyFilter(newRaw: string, prevText: string, insertedText: string | null): string {
  if (insertedText != null && /[^0-9,-]/.test(insertedText)) return prevText;
  const firstComma = newRaw.indexOf(",");
  if (firstComma === -1) return newRaw;
  return newRaw.slice(0, firstComma + 1) + newRaw.slice(firstComma + 1).replace(/,/g, "");
}

function formatNum(n: number, decimals: number) {
  return n.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function digitsOnly(s: string): number {
  const cleaned = s.replace(/[^0-9]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function NumberInput({
  value,
  onChange,
  decimals = 0,
  className = "input",
  /** Saat true: format "Rp " + pemisah ribuan LANGSUNG saat mengetik (bukan cuma saat blur). Untuk field mata uang saja — bukan qty/berat. */
  currency = false,
  placeholder,
  /** Saat true: tampil KOSONG (bukan "0") selagi value masih 0 & belum pernah diketik user,
   *  supaya `placeholder` benar-benar terlihat sebagai ghost text. Scope kecil (dipakai di
   *  field harga wizard PV saja) — field lain TIDAK berubah perilaku. */
  startEmptyIfZero = false,
  /** Item 5: saat true, "." yang diketik user TIDAK PERNAH masuk ke state (dibuang saat onChange,
   *  bukan ditafsirkan sebagai pemisah ribuan) — cuma "," yang jadi desimal. Default false supaya
   *  SEMUA call site lain (mayoritas field) tetap persis seperti sebelumnya. Grouping pemisah ribuan
   *  ("." ala id-ID) tetap dirender saat blur seperti biasa (lewat formatNum), jadi tidak hilang. */
  commaOnly = false,
}: {
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
  className?: string;
  currency?: boolean;
  placeholder?: string;
  startEmptyIfZero?: boolean;
  commaOnly?: boolean;
}) {
  const initialEmpty = startEmptyIfZero && value === 0;
  const [text, setText] = useState(initialEmpty ? "" : currency ? "Rp " + formatNum(value, 0) : formatNum(value, decimals));
  const [touched, setTouched] = useState(!initialEmpty);

  useEffect(() => {
    if (startEmptyIfZero && value === 0 && !touched) {
      setText("");
      return;
    }
    setText(currency ? "Rp " + formatNum(value, 0) : formatNum(value, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);

  if (currency) {
    return (
      <input
        value={text}
        onChange={(e) => {
          setTouched(true);
          const n = digitsOnly(e.target.value);
          setText(e.target.value === "" ? "" : "Rp " + formatNum(n, 0));
          onChange(n);
        }}
        inputMode="numeric"
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <input
      value={text}
      onChange={(e) => {
        if (!commaOnly) {
          setText(e.target.value);
          return;
        }
        // InputEvent.data: teks yang baru saja disisipkan (ketik 1 karakter ATAU paste sekaligus),
        // `null` untuk operasi hapus -- lihat catatan panjang di commaOnlyFilter. Kalau `nativeEvent`
        // BUKAN InputEvent asli (mis. event disintesis manual, bukan interaksi keyboard/mouse
        // sungguhan), delta-nya tidak bisa diketahui pasti -- fallback-nya sengaja KETAT (anggap
        // SELURUH string baru sebagai "yang baru masuk", jadi ditolak total kalau mengandung
        // karakter tidak valid) alih-alih longgar (lolos tanpa cek), supaya tidak ada jalur yang
        // diam-diam kurang aman dibanding perilaku ketik/paste normal.
        const insertedText = e.nativeEvent instanceof InputEvent ? e.nativeEvent.data : e.target.value;
        setText(commaOnlyFilter(e.target.value, text, insertedText));
      }}
      onBlur={() => {
        const parsed = commaOnly ? parseCommaNumber(text) : parseLocaleNumber(text);
        onChange(parsed);
        setText(formatNum(parsed, decimals));
      }}
      inputMode="decimal"
      placeholder={placeholder}
      className={className}
    />
  );
}
