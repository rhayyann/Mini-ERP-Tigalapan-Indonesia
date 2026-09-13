"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { HargaMaklonPanel } from "@/components/procurement/harga-maklon-panel";
import { HargaKainPanel } from "@/components/procurement/harga-kain-panel";
import { HargaKainPksPanel } from "@/components/procurement/harga-kain-pks-panel";
import { SupplierPanel } from "@/components/procurement/supplier-panel";
import { EkspedisiRatePanel } from "@/components/procurement/ekspedisi-rate-panel";

type Tab = "maklon" | "kain" | "kainPks" | "supplier" | "ekspedisi";

export default function ProcurementMasterDataPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState<Tab>("maklon");

  if (!mounted) return null;

  return (
    <AppShell role="procurement" activeHref="/procurement/master-data" breadcrumb={["Dashboard", "Master Data"]} title="Master Data">
      <Tabs
        items={[
          { key: "maklon", label: "Harga Maklon" },
          { key: "kain", label: "Harga Kain" },
          { key: "kainPks", label: "Harga Kain PKS" },
          { key: "supplier", label: "Supplier" },
          { key: "ekspedisi", label: "Ekspedisi" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === "maklon" && <HargaMaklonPanel />}
      {tab === "kain" && <HargaKainPanel />}
      {tab === "kainPks" && <HargaKainPksPanel />}
      {tab === "supplier" && <SupplierPanel />}
      {tab === "ekspedisi" && <EkspedisiRatePanel />}
    </AppShell>
  );
}
