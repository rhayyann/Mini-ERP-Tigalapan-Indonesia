"use client";

import { useEffect, useState } from "react";

function parseLocaleNumber(s: string): number {
  const cleaned = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
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
}: {
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
  className?: string;
  currency?: boolean;
  placeholder?: string;
  startEmptyIfZero?: boolean;
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
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const parsed = parseLocaleNumber(text);
        onChange(parsed);
        setText(formatNum(parsed, decimals));
      }}
      inputMode="decimal"
      placeholder={placeholder}
      className={className}
    />
  );
}
