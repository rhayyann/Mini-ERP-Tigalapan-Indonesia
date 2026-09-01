import { redirect } from "next/navigation";

// Halaman standalone lama — kontennya sudah pindah ke tab "Invoice Vendor" di
// /raw-material (Paying Voucher (Invoice)), lihat components/procurement/invoice-vendor-review-panel.tsx.
export default function InvoiceVendorRedirectPage() {
  redirect("/raw-material?tab=vendor");
}
