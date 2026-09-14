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
  disabled = false,
  /** Fix (2026-09-15, owner-reported: "tidak bisa typing di Master Data, harus paste semua
   *  value"): saat true (HANYA dipasang di field yang `onChange`-nya menulis LANGSUNG ke server --
   *  semua panel Master Data: Ekspedisi, Harga Kain/Maklon/Kain PKS, Kerah/Manset), `onChange` ke
   *  parent DITUNDA sampai blur (persis pola varian non-currency yang SUDAH begini dari awal),
   *  BUKAN dipanggil di tiap keystroke seperti varian currency biasa. Root cause bug: varian
   *  currency awalnya memanggil onChange(n) di SETIAP keystroke -- kalau onChange itu men-trigger
   *  round-trip server (updateXRow optimistic + backgroundRefresh, pola SEMUA panel Master Data),
   *  ketik cepat bisa memicu BEBERAPA round-trip yang selesai TIDAK BERURUTAN (refresh dari
   *  keystroke LEBIH AWAL datang TERAKHIR, menimpa balik value ke versi lebih pendek). Paste tidak
   *  kena (1 event/1 round-trip). Reformat tampilan "Rp X.XXX" TETAP live per keystroke (murni
   *  `text` state lokal, tidak butuh nunggu server) -- yang ditunda cuma PEMBERITAHUAN ke parent.
   *  Default false -- field currency LAIN (live preview di wizard/modal, mis.
   *  claim-replacement-modal.tsx/paying-voucher-wizard.tsx yang onChange-nya cuma nulis ke state
   *  LOKAL komponen, bukan ke server) TETAP dapat onChange per-keystroke seperti sebelumnya --
   *  prop ini SENGAJA opt-in, bukan mengubah perilaku default currency yang sudah ada. */
  commitOnBlurOnly = false,
}: {
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
  className?: string;
  currency?: boolean;
  placeholder?: string;
  startEmptyIfZero?: boolean;
  commaOnly?: boolean;
  disabled?: boolean;
  commitOnBlurOnly?: boolean;
}) {
  const initialEmpty = startEmptyIfZero && value === 0;
  const [text, setText] = useState(initialEmpty ? "" : currency ? "Rp " + formatNum(value, 0) : formatNum(value, decimals));
  const [touched, setTouched] = useState(!initialEmpty);
  // Fix (2026-09-15, owner-reported: "tidak bisa typing, harus paste semua value" di form Master
  // Data): varian `currency` memanggil `onChange(n)` di SETIAP keystroke (lihat di bawah) -- kalau
  // `onChange` pemanggilnya menulis LANGSUNG ke server (pola SEMUA panel Master Data: Ekspedisi,
  // Harga Kain/Maklon/Kain PKS, Kerah/Manset -- `updateXRow` optimistic + backgroundRefresh), tiap
  // karakter yang diketik memicu round-trip server SENDIRI-SENDIRI. Kalau user ngetik cepat (mis.
  // "120000", 6 keystroke), 6 round-trip itu bisa SELESAI TIDAK BERURUTAN -- backgroundRefresh dari
  // keystroke ke-2 ("12") bisa DATANG TERAKHIR (setelah keystroke ke-6 "120000" sudah ke-apply
  // duluan di layar), menimpa balik `value` prop jadi versi LAMA yang lebih pendek SAAT USER MASIH
  // FOKUS di field itu -- persis "kelihatan tidak bisa ngetik, tiap ketik balik lagi ke lama".
  // Paste tidak kena karena cuma 1 event/1 round-trip, tidak ada yang bisa saling salip.
  // Fix: `useEffect` di bawah (yang mem-format ULANG `text` dari `value` prop) SENGAJA DILEWATI
  // selagi field ini SEDANG FOKUS (user masih aktif mengetik) -- `value` prop yang "telat"/salip
  // itu tetap boleh masuk ke React state, cuma TIDAK dipakai menimpa apa yang user ketik SAAT INI.
  // Begitu blur, `onBlur` (varian non-currency) atau update value baru dari keystroke TERAKHIR akan
  // menyamakan lagi -- hasil akhirnya tetap konsisten, cuma tidak lagi "berkedip" mundur di tengah.
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    if (startEmptyIfZero && value === 0 && !touched) {
      setText("");
      return;
    }
    setText(currency ? "Rp " + formatNum(value, 0) : formatNum(value, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency, focused]);

  if (currency) {
    return (
      <input
        value={text}
        onChange={(e) => {
          setTouched(true);
          const n = digitsOnly(e.target.value);
          setText(e.target.value === "" ? "" : "Rp " + formatNum(n, 0));
          // commitOnBlurOnly: tampilan tetap live (setText di atas), TAPI parent baru diberi tahu
          // saat blur (lihat onBlur di bawah) -- itulah yang menutup race round-trip server, bukan
          // cuma guard `focused` di useEffect (yang cuma melindungi TAMPILAN, tidak mencegah
          // round-trip liar itu sendiri terjadi -- lihat catatan panjang di prop commitOnBlurOnly).
          if (!commitOnBlurOnly) onChange(n);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (commitOnBlurOnly) onChange(digitsOnly(text));
        }}
        inputMode="numeric"
        placeholder={placeholder}
        className={className}
        disabled={disabled}
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
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = commaOnly ? parseCommaNumber(text) : parseLocaleNumber(text);
        onChange(parsed);
        setText(formatNum(parsed, decimals));
      }}
      inputMode="decimal"
      placeholder={placeholder}
      className={className}
      disabled={disabled}
    />
  );
}
