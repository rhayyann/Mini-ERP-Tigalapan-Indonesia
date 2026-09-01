export type NavItem = { label: string; href?: string; badge?: number };

export type RoleKey = "ppic" | "procurement" | "finance" | "scm" | "produksi" | "vendorMaklon" | "vendorSupplier" | "admin";

export type RoleNav = {
  role: string;
  entity: string;
  items: NavItem[];
};

export const NAV: Record<RoleKey, RoleNav> = {
  ppic: {
    role: "PPIC",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/dashboard/ppic" },
      { label: "MRP", href: "/mrp/ppic" },
    ],
  },
  procurement: {
    role: "Procurement",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/dashboard/procurement" },
      { label: "Purchase Order", href: "/procurement/po-approval" },
      { label: "Paying Voucher (Invoice)", href: "/raw-material" },
      { label: "Material Tracking", href: "/procurement/material-tracking" },
      { label: "Klaim Material", href: "/procurement/material-claims" },
      { label: "Master Data", href: "/procurement/master-data" },
    ],
  },
  finance: {
    role: "Finance",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Dashboard", href: "/dashboard/finance" },
      { label: "PO Approval", href: "/finance/po-approval" },
      { label: "Payment", href: "/finance/payment" },
      { label: "Ledger", href: "/finance/ledger" },
      { label: "Laporan HPP", href: "/finance/laporan-hpp" },
      { label: "Master Data", href: "/finance/master-data" },
    ],
  },
  scm: {
    role: "SCM",
    entity: "Tigalapan Indonesia",
    items: [
      { label: "Approval MRP", href: "/scm/approval-mrp" },
      { label: "Monitoring", href: "/scm/monitoring" },
    ],
  },
  produksi: {
    role: "Produksi",
    entity: "Tigalapan Indonesia",
    items: [{ label: "Monitoring Produksi", href: "/produksi/monitoring" }],
  },
  vendorMaklon: {
    role: "PT Maklon ABC",
    entity: "Vendor Maklon",
    items: [
      { label: "PO Produksi Saya", href: "/vendor-maklon/po-produksi" },
      { label: "PO Material Saya", href: "/vendor-maklon/po-material" },
      { label: "Good Receive", href: "/vendor-maklon/receiving" },
      { label: "Produksi", href: "/vendor-maklon/production" },
      { label: "Pengiriman", href: "/vendor-maklon/pengiriman" },
      { label: "Invoice & Payment", href: "/vendor-maklon/invoice-payment" },
    ],
  },
  vendorSupplier: {
    role: "PT Supplier ABC",
    entity: "Vendor Supplier",
    items: [
      { label: "Order Saya", href: "/dashboard/vendor-supplier" },
      { label: "Invoice" },
      { label: "Status Pembayaran" },
      { label: "Dokumen" },
    ],
  },
  admin: {
    role: "Admin",
    entity: "Administrasi sistem",
    items: [
      { label: "Overview", href: "/dashboard/admin" },
      { label: "Users" },
      { label: "Entities" },
      { label: "SLA Config" },
      { label: "Settings" },
      { label: "System Logs" },
    ],
  },
};
