"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { VendorAuthGuard } from "@/components/mrp/vendor-auth-guard";
import { InvoiceVendorPanel } from "@/components/vendor-maklon/invoice-vendor-panel";
import { InvoiceMaklonPanel } from "@/components/vendor-maklon/invoice-maklon-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { countVendorInvoiceableMrp } from "@/lib/shell/badges";
import { VENDOR_PRODUKSI } from "@/lib/mrp/seed";

function InvoicePaymentContent({ vendorId }: { vendorId: string }) {
  const mrpDetails = useMrpStore((s) => s.mrpDetails);
  const deliveryKolis = useMrpStore((s) => s.deliveryKolis);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const maklonInvoices = useMrpStore((s) => s.maklonInvoices);

  const [tab, setTab] = useState<"vendor" | "maklon">("vendor");

  // Invoice Maklon sekarang murni arsip (tidak ada aksi baru) — tidak dikasih badge lagi,
  // konsisten dengan pola "no action = no badge" yang dipakai di halaman lain (mis. PO
  // Produksi Saya setelah triggernya dipindah).
  const vendorBadge = countVendorInvoiceableMrp(vendorId, mrpDetails, deliveryKolis, vendorInvoices, maklonInvoices);

  return (
    <AppShell
      role="vendorMaklon"
      vendorId={vendorId}
      activeHref="/vendor-maklon/invoice-payment"
      breadcrumb={["Dashboard", "Invoice & Payment"]}
      title="Invoice & Payment"
      subtitle="Buat invoice untuk seluruh qty planned — bisa diajukan begitu delivery pertama sudah jalan. Maksimal total qty = kapasitas produksi vendor"
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
