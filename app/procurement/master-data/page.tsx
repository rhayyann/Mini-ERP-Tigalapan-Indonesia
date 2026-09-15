"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Tabs } from "@/components/ui/tabs";
import { HargaMaklonPanel } from "@/components/procurement/harga-maklon-panel";
import { HargaKainPanel } from "@/components/procurement/harga-kain-panel";
import { HargaKainPksPanel } from "@/components/procurement/harga-kain-pks-panel";
import { EkspedisiRatePanel } from "@/components/procurement/ekspedisi-rate-panel";
import { KerahMansetSettingsPanel } from "@/components/procurement/kerah-manset-settings-panel";

// Item revisi 2026-09-15 (owner: tab "Supplier" dihapus dari menu Master Data -- datanya memang
// kosong/tidak pernah dipakai, dicek langsung ke DB sebelum dihapus, lihat catatan di
// components/procurement/supplier-panel.tsx yang TETAP DIBIARKAN ADA sebagai file -- store action
// & merge ke dropdown "Vendor material" (materialSupplierNames di lib/mrp/derive.ts) SENGAJA TIDAK
// disentuh, murni tab/menu-nya yang disembunyikan sesuai permintaan ("hapus tabnya saja").
type Tab = "maklon" | "kain" | "kainPks" | "ekspedisi" | "kerahManset";

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
          { key: "ekspedisi", label: "Ekspedisi" },
          { key: "kerahManset", label: "Kerah/Manset" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === "maklon" && <HargaMaklonPanel />}
      {tab === "kain" && <HargaKainPanel />}
      {tab === "kainPks" && <HargaKainPksPanel />}
      {tab === "ekspedisi" && <EkspedisiRatePanel />}
      {tab === "kerahManset" && <KerahMansetSettingsPanel />}
    </AppShell>
  );
}
