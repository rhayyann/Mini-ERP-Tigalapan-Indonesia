"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { PaymentPanel } from "@/components/finance/payment-panel";
import { PaymentMaklonPanel } from "@/components/finance/payment-maklon-panel";
import { useMrpStore } from "@/lib/mrp/store";
import { countPaymentMaklonReady, countPaymentMaterialReady } from "@/lib/shell/badges";

function FinancePaymentContent() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const searchParams = useSearchParams();
  const invoices = useMrpStore((s) => s.invoices);
  const vendorInvoices = useMrpStore((s) => s.vendorInvoices);
  const [tab, setTab] = useState<"material" | "maklon">(searchParams.get("tab") === "maklon" ? "maklon" : "material");

  if (!mounted) return null;

  const materialBadge = countPaymentMaterialReady(invoices);
  const maklonBadge = countPaymentMaklonReady(vendorInvoices);

  return (
    <AppShell role="finance" activeHref="/finance/payment" breadcrumb={["Dashboard", "Payment"]} title="Payment">
      <Tabs
        items={[
          { key: "material", label: "Payment", badge: materialBadge },
          { key: "maklon", label: "Payment Maklon", badge: maklonBadge },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "material" | "maklon")}
      />
      {tab === "material" ? <PaymentPanel /> : <PaymentMaklonPanel />}
    </AppShell>
  );
}

// useSearchParams() WAJIB dibungkus <Suspense> supaya bisa di-static-export (lihat catatan sama
// di app/raw-material/page.tsx).
export default function FinancePaymentPage() {
  return (
    <Suspense fallback={null}>
      <FinancePaymentContent />
    </Suspense>
  );
}
