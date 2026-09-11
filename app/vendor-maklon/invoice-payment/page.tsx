"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { InvoiceVendorPanel } from "@/components/vendor-maklon/invoice-vendor-panel";
import { InvoiceMaklonPanel } from "@/components/vendor-maklon/invoice-maklon-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { countVendorInvoicePaymentTotal } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

function InvoicePaymentContent({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  const [tab, setTab] = useState<"vendor" | "maklon">("vendor");

  // Item migration 0026: sub-tab Invoice Vendor juga sudah tidak punya aksi lagi (Create Invoice
  // manual dihapus, submit invoice sekarang di halaman Pengiriman per resi-group) — jadi SEKARANG
  // kedua sub-tab murni arsip, konsisten dengan pola "no action = no badge" yang dipakai di
  // halaman lain (mis. PO Produksi Saya setelah triggernya dipindah). countVendorInvoicePaymentTotal
  // sekarang selalu 0 (lihat lib/shell/badges.ts), dipertahankan pemanggilannya di sini
  // sekadar biar konsisten kalau nanti perlu dihidupkan lagi.
  const vendorBadge = countVendorInvoicePaymentTotal(vendorId, mrpDetails, deliveryKolis, vendorInvoices, maklonInvoices);

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/invoice-payment"
      breadcrumb={["Dashboard", "Invoice & Payment"]}
      title="Invoice & Payment"
      subtitle="Buat invoice untuk qty yang sudah dikirim (lihat Pengiriman) — bertambah begitu koli baru terkirim. Maksimal total qty = kapasitas produksi vendor"
      roleOverride={VENDOR_PRODUKSI[vendorId]?.name ?? vendorId}
      entityOverride="Vendor Produksi"
    >
      <Tabs
        items={[
          { key: "vendor", label: "Invoice Vendor (per pcs)", badge: vendorBadge },
          { key: "maklon", label: "Invoice Maklon (Arsip)" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "vendor" | "maklon")}
      />
      {tab === "vendor" ? <InvoiceVendorPanel vendorId={vendorId} /> : <InvoiceMaklonPanel vendorId={vendorId} />}
    </AppShell>
  );
}

export default function VendorInvoicePaymentPage() {
  return <VendorAuthGuard>{(vendorId) => <InvoicePaymentContent vendorId={vendorId} />}</VendorAuthGuard>;
}
