// CATATAN MIGRASI SUPABASE: password modul dulu ada di sini (plaintext, ikut ter-bundle
// ke client -- bisa dibaca siapapun lewat DevTools/view-source). Sekarang password
// dicek server-only dari env var INTERNAL_PASSWORD_<ROLE> (lihat lib/auth/actions.ts),
// jadi file ini cuma menyimpan info non-sensitif (label/homeHref) yang aman dipakai UI.
export type InternalRole = "ppic" | "procurement" | "finance" | "scm" | "produksi";

export type InternalAccount = {
  role: InternalRole;
  label: string;
  homeHref: string;
};

export const INTERNAL_ACCOUNTS: InternalAccount[] = [
  { role: "ppic", label: "PPIC", homeHref: "/dashboard/ppic" },
  { role: "procurement", label: "Procurement", homeHref: "/dashboard/procurement" },
  { role: "finance", label: "Finance", homeHref: "/dashboard/finance" },
  // SCM: jembatan approval MRP dari PPIC sebelum masuk Procurement + monitoring lintas modul
  // (lihat ppicApproval di lib/mrp/store.ts). Produksi: monitoring progres semua vendor produksi
  // lintas MRP — read-only, tidak ada aksi approval/input.
  { role: "scm", label: "SCM", homeHref: "/scm/approval-mrp" },
  { role: "produksi", label: "Produksi", homeHref: "/produksi/monitoring" },
];

export function internalAccountFor(role: InternalRole): InternalAccount | undefined {
  return INTERNAL_ACCOUNTS.find((a) => a.role === role);
}
