export type InternalRole = "ppic" | "procurement" | "finance" | "scm" | "produksi";

export type InternalAccount = {
  role: InternalRole;
  label: string;
  password: string;
  homeHref: string;
};

export const INTERNAL_ACCOUNTS: InternalAccount[] = [
  { role: "ppic", label: "PPIC", password: "ppic123", homeHref: "/dashboard/ppic" },
  { role: "procurement", label: "Procurement", password: "procurement123", homeHref: "/dashboard/procurement" },
  { role: "finance", label: "Finance", password: "finance123", homeHref: "/dashboard/finance" },
  // SCM: jembatan approval MRP dari PPIC sebelum masuk Procurement + monitoring lintas modul
  // (lihat ppicApproval di lib/mrp/store.ts). Produksi: monitoring progres semua vendor produksi
  // lintas MRP — read-only, tidak ada aksi approval/input.
  { role: "scm", label: "SCM", password: "scm123", homeHref: "/scm/approval-mrp" },
  { role: "produksi", label: "Produksi", password: "produksi123", homeHref: "/produksi/monitoring" },
];

export function internalAccountFor(role: InternalRole): InternalAccount | undefined {
  return INTERNAL_ACCOUNTS.find((a) => a.role === role);
}
